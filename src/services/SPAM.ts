import AsyncStorage from "@react-native-async-storage/async-storage";
import { collection, doc, getDocs, runTransaction, serverTimestamp, writeBatch, } from "firebase/firestore";
import { NativeModules, PermissionsAndroid, Platform } from "react-native";
import { auth, db } from "../../FirebaseConfig";

const HISTORIC_CALL_LIMIT = 100;
const MAX_STORED_CALLS = 1000;
const FIRESTORE_BATCH_SIZE = 450;
const SPAM_CALL_MAX_DURATION_SECONDS = 6;
const BLOCK_AFTER_OCCURRENCES = 5;
const SUSPICIOUS_CALL_TYPES = ["INCOMING", "MISSED"];

export type ShortIncomingCall = {
  phoneNumber: string;
  durationSeconds: number;
  callTimestamp: number;
};

export type BlockedNumber = {
  id: string;
  phoneNumber: string;
  occurrences: number;
};

type StoredBlockedNumber = BlockedNumber & {
  blocked: boolean;
  automaticallyBlocked: boolean;
  globalBlocked: boolean;
};

type StoredShortIncomingCall = ShortIncomingCall & {
  id: string;
};

type SyncResult = {
  permissionGranted: boolean;
  permissionStatus: string;
  shortCallsInWindowCount: number;
  blockedNumbersCount: number;
  callScreeningRoleGranted: boolean;
  globalSyncError: string | null;
};

type FirebaseSyncResult = {
  callCount: number;
};

type CallScreeningNativeModule = {
  getPersistedBlockedNumbers(userId: string): Promise<string[]>;
  updateBlockedNumbers(userId: string, numbers: string[]): Promise<void>;
  isCallScreeningRoleHeld(): Promise<boolean>;
  requestCallScreeningRole(): Promise<boolean>;
};

const callScreening = NativeModules.SmsReader as
  | CallScreeningNativeModule
  | undefined;
const activeCallHistoryUploads = new Map<
  string,
  Promise<FirebaseSyncResult>
>();

function getCallScreeningModule(): CallScreeningNativeModule {
  if (!callScreening) {
    throw new Error(
      "O bloqueio de chamadas não está disponível. Recompile o app Android.",
    );
  }

  return callScreening;
}

function getNormalizedPhoneNumber(phoneNumber: string): string {
  return phoneNumber.replace(/\D/g, "");
}

async function reportShortCallGlobally(
  userId: string,
  call: StoredShortIncomingCall,
): Promise<boolean> {
  const normalizedNumber = getNormalizedPhoneNumber(call.phoneNumber);
  if (
    !normalizedNumber ||
    !Number.isFinite(call.durationSeconds) ||
    call.durationSeconds < 0 ||
    call.durationSeconds > SPAM_CALL_MAX_DURATION_SECONDS
  ) {
    throw new Error("Não foi possível registrar uma chamada suspeita inválida.");
  }

  const blockedNumberRef = doc(db, "blockedNumbers", normalizedNumber);
  const reportId = encodeURIComponent(`${userId}:${call.id}`);
  const reportRef = doc(collection(blockedNumberRef, "reports"), reportId);

  return runTransaction(db, async (transaction) => {
    const reportSnapshot = await transaction.get(reportRef);
    if (reportSnapshot.exists()) {
      return false;
    }

    const blockedNumberSnapshot = await transaction.get(blockedNumberRef);
    const blockedNumberData = blockedNumberSnapshot.data();
    const currentOccurrences =
      typeof blockedNumberData?.occurrences === "number"
        ? blockedNumberData.occurrences
        : 0;
    if (!Number.isSafeInteger(currentOccurrences) || currentOccurrences < 0) {
      throw new Error("A contagem global de chamadas está inválida.");
    }

    const occurrences = currentOccurrences + 1;
    const shouldBlock =
      occurrences >= BLOCK_AFTER_OCCURRENCES ||
      blockedNumberData?.blocked === true;

    transaction.set(reportRef, {
      userId,
      callId: call.id,
      createdAt: serverTimestamp(),
    });
    transaction.set(
      blockedNumberRef,
      {
        phoneNumber: call.phoneNumber,
        occurrences,
        blocked: shouldBlock,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    return shouldBlock;
  });
}

function getBlockedNumbersStorageKey(userId: string): string {
  return `@tcc/blocked-numbers/${userId}`;
}

function getShortCallsStorageKey(userId: string): string {
  return `@tcc/short-incoming-calls/${userId}`;
}

function getReportedShortCallsStorageKey(userId: string): string {
  return `@tcc/reported-short-incoming-calls/${userId}`;
}

function parseReportedShortCallIds(value: string | null): string[] {
  if (value === null) {
    return [];
  }

  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === "string")) {
    throw new Error("A lista local de chamadas sincronizadas está inválida.");
  }

  return parsed;
}

function getUserId(): string {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("É necessário entrar na conta para gerenciar os bloqueios.");
  }

  return user.uid;
}

function parseStoredBlockedNumbers(value: string | null): StoredBlockedNumber[] {
  if (value === null) {
    return [];
  }

  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error("A lista local de bloqueios está inválida.");
  }

  return parsed.map((entry: unknown) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("id" in entry) ||
      typeof entry.id !== "string" ||
      !("phoneNumber" in entry) ||
      typeof entry.phoneNumber !== "string" ||
      !("occurrences" in entry) ||
      typeof entry.occurrences !== "number" ||
      !Number.isFinite(entry.occurrences) ||
      !("blocked" in entry) ||
      typeof entry.blocked !== "boolean" ||
      ("automaticallyBlocked" in entry &&
        typeof entry.automaticallyBlocked !== "boolean") ||
      ("globalBlocked" in entry && typeof entry.globalBlocked !== "boolean")
    ) {
      throw new Error("A lista local de bloqueios contém dados inválidos.");
    }

    return {
      id: entry.id,
      phoneNumber: entry.phoneNumber,
      occurrences: entry.occurrences,
      blocked: entry.blocked,
      automaticallyBlocked:
        "automaticallyBlocked" in entry &&
        typeof entry.automaticallyBlocked === "boolean"
          ? entry.automaticallyBlocked
          : false,
      globalBlocked:
        "globalBlocked" in entry && typeof entry.globalBlocked === "boolean"
          ? entry.globalBlocked
          : false,
    };
  });
}

function parseStoredShortCalls(value: string | null): StoredShortIncomingCall[] {
  if (value === null) {
    return [];
  }

  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error("O histórico local de chamadas está inválido.");
  }

  return parsed.map((entry: unknown) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("id" in entry) ||
      typeof entry.id !== "string" ||
      !("phoneNumber" in entry) ||
      typeof entry.phoneNumber !== "string" ||
      !("durationSeconds" in entry) ||
      typeof entry.durationSeconds !== "number" ||
      !("callTimestamp" in entry) ||
      typeof entry.callTimestamp !== "number"
    ) {
      throw new Error("O histórico local de chamadas contém dados inválidos.");
    }

    return {
      id: entry.id,
      phoneNumber: entry.phoneNumber,
      durationSeconds: entry.durationSeconds,
      callTimestamp: entry.callTimestamp,
    };
  });
}

async function getStoredBlockedNumbers(
  userId: string,
): Promise<StoredBlockedNumber[]> {
  const value = await AsyncStorage.getItem(getBlockedNumbersStorageKey(userId));
  if (value !== null) {
    return parseStoredBlockedNumbers(value);
  }

  if (Platform.OS !== "android") {
    return [];
  }

  const legacyNumbers =
    await getCallScreeningModule().getPersistedBlockedNumbers(userId);
  const migratedNumbers = [
    ...new Set(legacyNumbers.map(getNormalizedPhoneNumber).filter(Boolean)),
  ].map((number) => ({
    id: number,
    phoneNumber: number,
    occurrences: 0,
    blocked: true,
    automaticallyBlocked: false,
    globalBlocked: false,
  }));
  await saveBlockedNumbers(userId, migratedNumbers);
  return migratedNumbers;
}

async function getStoredShortCalls(
  userId: string,
): Promise<StoredShortIncomingCall[]> {
  const value = await AsyncStorage.getItem(getShortCallsStorageKey(userId));
  return parseStoredShortCalls(value);
}

async function saveBlockedNumbers(
  userId: string,
  blockedNumbers: StoredBlockedNumber[],
): Promise<void> {
  await AsyncStorage.setItem(
    getBlockedNumbersStorageKey(userId),
    JSON.stringify(blockedNumbers),
  );
}

async function syncGlobalBlockedNumbers(userId: string): Promise<void> {
  const globalBlockedNumbers = await getDocs(
    collection(db, "blockedNumbers"),
  );
  const storedBlockedNumbers = await getStoredBlockedNumbers(userId);

  for (const blockedDocument of globalBlockedNumbers.docs) {
    const data = blockedDocument.data();
    if (data.blocked === false) {
      continue;
    }

    const phoneNumber =
      typeof data.phoneNumber === "string"
        ? data.phoneNumber.trim()
        : blockedDocument.id;
    const normalizedNumber = getNormalizedPhoneNumber(phoneNumber);
    if (!normalizedNumber) {
      continue;
    }

    const existingNumber = storedBlockedNumbers.find(
      (blockedNumber) => blockedNumber.id === normalizedNumber,
    );
    if (existingNumber) {
      existingNumber.globalBlocked = true;
      existingNumber.blocked = true;
      if (typeof data.occurrences === "number") {
        existingNumber.occurrences = data.occurrences;
      }
    } else {
      storedBlockedNumbers.push({
        id: normalizedNumber,
        phoneNumber,
        occurrences:
          typeof data.occurrences === "number" ? data.occurrences : 0,
        blocked: true,
        automaticallyBlocked: false,
        globalBlocked: true,
      });
    }
  }
  await saveBlockedNumbers(userId, storedBlockedNumbers);
  await saveBlockedNumbers(userId, storedBlockedNumbers);
}

async function getActiveBlockedNumbers(
  userId: string,
): Promise<BlockedNumber[]> {
  return (await getStoredBlockedNumbers(userId))
    .filter((blockedNumber) => blockedNumber.blocked)
    .map(({ id, phoneNumber, occurrences }) => ({
      id,
      phoneNumber,
      occurrences,
    }))
    .sort((first, second) =>
      first.phoneNumber.localeCompare(second.phoneNumber),
    );
}

async function syncNativeBlockedNumbers(
  userId: string,
  blockedNumbers: BlockedNumber[],
): Promise<void> {
  if (Platform.OS !== "android") {
    return;
  }

  await getCallScreeningModule().updateBlockedNumbers(
    userId,
    blockedNumbers.map((blockedNumber) => blockedNumber.phoneNumber),
  );
}

export async function requestCallScreeningRole(): Promise<boolean> {
  if (Platform.OS !== "android") {
    return false;
  }

  return getCallScreeningModule().requestCallScreeningRole();
}

export async function getBlockedNumbers(): Promise<BlockedNumber[]> {
  return getActiveBlockedNumbers(getUserId());
}

export async function addBlockedNumber(phoneNumber: string): Promise<void> {
  const userId = getUserId();
  const trimmedNumber = phoneNumber.trim();
  const normalizedNumber = getNormalizedPhoneNumber(trimmedNumber);
  if (!normalizedNumber) {
    throw new Error("Informe um número de telefone válido.");
  }

  const storedNumbers = await getStoredBlockedNumbers(userId);
  const existingNumber = storedNumbers.find(
    (number) => number.id === normalizedNumber,
  );
  if (existingNumber) {
    existingNumber.phoneNumber = trimmedNumber;
    existingNumber.blocked = true;
  } else {
    storedNumbers.push({
      id: normalizedNumber,
      phoneNumber: trimmedNumber,
      occurrences: 0,
      blocked: true,
      automaticallyBlocked: false,
      globalBlocked: false,
    });
  }

  await saveBlockedNumbers(userId, storedNumbers);
  await syncNativeBlockedNumbers(
    userId,
    await getActiveBlockedNumbers(userId),
  );
}

export async function removeBlockedNumber(numberId: string): Promise<void> {
  const userId = getUserId();
  const storedNumbers = await getStoredBlockedNumbers(userId);
  const numberToUnblock = storedNumbers.find(
    (number) => number.id === numberId,
  );
  if (!numberToUnblock) {
    throw new Error("O número não foi encontrado na lista de bloqueios.");
  }

  numberToUnblock.blocked = false;
  await saveBlockedNumbers(userId, storedNumbers);
  await syncNativeBlockedNumbers(
    userId,
    await getActiveBlockedNumbers(userId),
  );
}

export async function getShortIncomingCalls(): Promise<ShortIncomingCall[]> {
  const calls = await getStoredShortCalls(getUserId());
  return calls
    .map(({ phoneNumber, durationSeconds, callTimestamp }) => ({
      phoneNumber,
      durationSeconds,
      callTimestamp,
    }))
    .sort((first, second) => second.callTimestamp - first.callTimestamp);
}

export function syncShortCallsToFirebase(): Promise<FirebaseSyncResult> {
  const userId = auth.currentUser?.uid;
  if (!userId) {
    return Promise.reject(
      new Error("É necessário entrar na conta para sincronizar o histórico."),
    );
  }

  const activeUpload = activeCallHistoryUploads.get(userId);
  if (activeUpload) {
    return activeUpload;
  }

  const upload = uploadShortCallsToFirebase(userId).finally(() => {
    activeCallHistoryUploads.delete(userId);
  });
  activeCallHistoryUploads.set(userId, upload);
  return upload;
}

async function uploadShortCallsToFirebase(
  userId: string,
): Promise<FirebaseSyncResult> {
  const calls = await getStoredShortCalls(userId);
  const callsCollection = collection(db, "users", userId, "shortIncomingCalls");

  for (let offset = 0; offset < calls.length; offset += FIRESTORE_BATCH_SIZE) {
    const batch = writeBatch(db);
    const callsBatch = calls.slice(offset, offset + FIRESTORE_BATCH_SIZE);

    for (const call of callsBatch) {
      batch.set(
        doc(callsCollection, encodeURIComponent(call.id)),
        {
          phoneNumber: call.phoneNumber,
          durationSeconds: call.durationSeconds,
          callTimestamp: call.callTimestamp,
          savedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }

    await batch.commit();
  }

  const reportedCallIds = new Set(
    parseReportedShortCallIds(
      await AsyncStorage.getItem(getReportedShortCallsStorageKey(userId)),
    ),
  );
  let shouldRefreshGlobalBlockedNumbers = false;
  for (const call of calls) {
    if (reportedCallIds.has(call.id)) {
      continue;
    }

    const shouldBlock = await reportShortCallGlobally(userId, call);
    reportedCallIds.add(call.id);
    if (shouldBlock) {
      shouldRefreshGlobalBlockedNumbers = true;
    }
  }

  await AsyncStorage.setItem(
    getReportedShortCallsStorageKey(userId),
    JSON.stringify([...reportedCallIds].slice(-MAX_STORED_CALLS)),
  );

  if (shouldRefreshGlobalBlockedNumbers) {
    await syncGlobalBlockedNumbers(userId);
    await syncNativeBlockedNumbers(
      userId,
      await getActiveBlockedNumbers(userId),
    );
  }

  return {
    callCount: calls.length,
  };
}

export async function syncShortIncomingCalls(): Promise<SyncResult> {
  if (Platform.OS !== "android") {
    throw new Error(
      "A leitura do histórico de chamadas só está disponível no Android.",
    );
  }

  const userId = getUserId();
  let globalSyncError: string | null = null;
  try {
    await syncGlobalBlockedNumbers(userId);
  } catch (error) {
    console.error("Erro ao sincronizar bloqueios globais:", error);
    globalSyncError =
      "Não foi possível atualizar a lista global; os bloqueios salvos neste dispositivo continuam ativos.";
  }

  const storedBlockedNumbers = await getStoredBlockedNumbers(userId);
  const activeBlockedNumbers = storedBlockedNumbers.filter(
    (blockedNumber) => blockedNumber.blocked,
  );
  await syncNativeBlockedNumbers(userId, activeBlockedNumbers);

  const callLogPermission = PermissionsAndroid.PERMISSIONS.READ_CALL_LOG;
  const permissionGranted = await PermissionsAndroid.check(callLogPermission);
  const permissionStatus = permissionGranted
    ? PermissionsAndroid.RESULTS.GRANTED
    : await PermissionsAndroid.request(callLogPermission, {
        title: "Permissão para acessar chamadas",
        message:
          "O app precisa acessar o histórico de chamadas para identificar ligações recebidas suspeitas.",
        buttonPositive: "Permitir",
        buttonNegative: "Agora não",
      });

  if (permissionStatus !== PermissionsAndroid.RESULTS.GRANTED) {
    return {
      permissionGranted: false,
      permissionStatus,
      shortCallsInWindowCount: 0,
      blockedNumbersCount: activeBlockedNumbers.length,
      callScreeningRoleGranted:
        await getCallScreeningModule().isCallScreeningRoleHeld(),
      globalSyncError,
    };
  }

  const { default: CallLogs } = await import("react-native-call-log");
  const calls = await CallLogs.load(HISTORIC_CALL_LIMIT);

  const savedCalls = await getStoredShortCalls(userId);
  const knownCallIds = new Set(savedCalls.map((call) => call.id));
  const shortCallsInWindow: StoredShortIncomingCall[] = [];

  for (const call of calls) {
    if (
      !SUSPICIOUS_CALL_TYPES.includes(call.type) ||
      call.duration < 0 ||
      call.duration > SPAM_CALL_MAX_DURATION_SECONDS ||
      !call.id ||
      !call.phoneNumber?.trim()
    ) {
      continue;
    }

    const callId = String(call.id);
    const callTimestamp = Number(call.timestamp);
    if (!Number.isFinite(callTimestamp)) {
      continue;
    }

    const shortCall: StoredShortIncomingCall = {
      id: callId,
      phoneNumber: call.phoneNumber.trim(),
      durationSeconds: call.duration,
      callTimestamp,
    };
    shortCallsInWindow.push(shortCall);

    if (knownCallIds.has(callId)) {
      continue;
    }

    savedCalls.push(shortCall);
    knownCallIds.add(callId);
  }

  savedCalls.sort((a, b) => b.callTimestamp - a.callTimestamp);
  const recentCalls = savedCalls.slice(0, MAX_STORED_CALLS);
  await AsyncStorage.setItem(
    getShortCallsStorageKey(userId),
    JSON.stringify(recentCalls),
  );

  await saveBlockedNumbers(userId, storedBlockedNumbers);
  const blockedNumbers = await getActiveBlockedNumbers(userId);
  await syncNativeBlockedNumbers(userId, blockedNumbers);
  const callScreeningRoleGranted =
  await getCallScreeningModule().isCallScreeningRoleHeld();

  return {
    permissionGranted: true,
    permissionStatus: PermissionsAndroid.RESULTS.GRANTED,
    shortCallsInWindowCount: shortCallsInWindow.length,
    blockedNumbersCount: blockedNumbers.length,
    callScreeningRoleGranted,
    globalSyncError,
  };
}