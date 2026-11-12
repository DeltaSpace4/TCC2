import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AppState, Linking, PermissionsAndroid, Platform, Text, TouchableOpacity, View } from "react-native";
import { auth } from "../../FirebaseConfig";
import { syncIncomingSmsWithLinks } from "../services/SMS";
import { requestCallScreeningRole, syncShortCallsToFirebase, syncShortIncomingCalls } from "../services/SPAM";
import { globalStyles } from "../styles/global";

export default function Home() {
  const [callSyncStatus, setCallSyncStatus] = useState("Solicitando acesso às chamadas...");
  const [firebaseCallSyncStatus, setFirebaseCallSyncStatus] = useState("");
  const [smsSyncStatus, setSmsSyncStatus] = useState("Solicitando acesso às mensagens...");
  const [callScreeningRoleGranted, setCallScreeningRoleGranted] = useState(false);
  const [isRequestingCallScreeningRole, setIsRequestingCallScreeningRole] = useState(false);
  const [callPermissionBlocked, setCallPermissionBlocked] = useState(false);
  const [smsPermissionBlocked, setSmsPermissionBlocked] = useState(false);
  const isSyncing = useRef(false);
  const isSyncingSms = useRef(false);
  const retryPermissionRequests = useRef<(() => void) | null>(null);

  useEffect(() => {
    const syncCalls = async () => {
      if (Platform.OS !== "android") {
        setCallSyncStatus("A leitura do histórico de chamadas está disponível apenas no Android.");
        return;
      }

      if (isSyncing.current) {
        return;
      }

      isSyncing.current = true;
      setCallSyncStatus("Verificando chamadas recebidas...");

      try {
        const result = await syncShortIncomingCalls();
        setCallScreeningRoleGranted(result.callScreeningRoleGranted);
        setCallPermissionBlocked(
          result.permissionStatus === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN,
        );
        if (!result.permissionGranted) {
          setCallSyncStatus(
            result.permissionStatus === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
              ? "Acesso às chamadas bloqueado. Ative a permissão nas configurações do Android."
              : "Acesso às chamadas não permitido. Toque para tentar novamente.",
          );
        } else if (result.shortCallsInWindowCount > 0) {
          setCallSyncStatus(
            `${result.shortCallsInWindowCount} ligação(ões) suspeita(s) de SPAM encontrada(s).`,
          );
        } else {
          setCallSyncStatus(
            "Nenhuma ligação suspeita de SPAM encontrada.",
          );
        }
      } catch (error) {
        console.error("Erro ao sincronizar chamadas curtas:", error);
        setCallSyncStatus(
          "Não foi possível solicitar acesso às chamadas. Verifique a permissão no Android.",
        );
      } finally {
        isSyncing.current = false;
        if (auth.currentUser) {
          setFirebaseCallSyncStatus("Sincronizando histórico com o Firebase...");
          void syncShortCallsToFirebase()
            .then(() => {
              setFirebaseCallSyncStatus("");
            })
            .catch((error: unknown) => {
              console.error("Erro ao sincronizar histórico com o Firebase:", error);
              setFirebaseCallSyncStatus(
                "Erro ao sincronizar histórico com o Firebase.",
              );
            });
        }
      }
    };

    const syncSms = async () => {
      if (Platform.OS !== "android") {
        setSmsSyncStatus("A leitura de mensagens está disponível apenas no Android.");
        return;
      }

      if (isSyncingSms.current) {
        return;
      }

      isSyncingSms.current = true;
      setSmsSyncStatus("Verificando mensagens recebidas...");

      try {
        const result = await syncIncomingSmsWithLinks();
        setSmsPermissionBlocked(
          result.permissionStatus === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN,
        );
        if (!result.permissionGranted) {
          setSmsSyncStatus(
            result.permissionStatus === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
              ? "Acesso às mensagens bloqueado. Ative a permissão nas configurações do Android."
              : "Acesso às mensagens não permitido. Toque para tentar novamente.",
          );
        } else if (result.savedCount > 0) {
          setSmsSyncStatus(
            `${result.savedCount} mensagem(ns) nova(s) com links foram encontrada(s).`,
          );
        } else {
          setSmsSyncStatus(
            "Verificação ativa. Nenhuma nova mensagem com link encontrada.",
          );
        }
      } catch (error) {
        console.error("Erro ao verificar mensagens recebidas:", error);
        setSmsSyncStatus(
          "Não foi possível solicitar acesso às mensagens. Verifique a permissão no Android.",
        );
      } finally {
        isSyncingSms.current = false;
      }
    };

    const syncFeatures = async () => {
      await syncCalls();
      await syncSms();
    };

    retryPermissionRequests.current = () => {
      void syncFeatures();
    };

    void syncFeatures();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void syncFeatures();
      }
    });

    return () => {
      retryPermissionRequests.current = null;
      subscription.remove();
    };
  }, []);

  return (
    <View style={globalStyles.container}>
      <Text style={globalStyles.title}>Home</Text>
      <Text style={globalStyles.empty}>{callSyncStatus}</Text>
      {firebaseCallSyncStatus ? (
        <Text style={globalStyles.empty}>{firebaseCallSyncStatus}</Text>
      ) : null}
      <Text style={globalStyles.empty}>{smsSyncStatus}</Text>
          {!callScreeningRoleGranted ? (
            <TouchableOpacity
              accessibilityRole="button"
              disabled={isRequestingCallScreeningRole}
              onPress={() => {
                setIsRequestingCallScreeningRole(true);
                void requestCallScreeningRole()
                  .then((isGranted) => {
                    setCallScreeningRoleGranted(isGranted);
                    if (!isGranted) {
                      setCallSyncStatus(
                        "O Android não ativou o bloqueio de chamadas.",
                      );
                    } else {
                      retryPermissionRequests.current?.();
                    }
                  })
                  .catch((error: unknown) => {
                    console.error("Erro ao ativar bloqueio de chamadas:", error);
                  })
                  .finally(() => {
                    setIsRequestingCallScreeningRole(false);
                  });
              }}
              style={globalStyles.button}
            >
              <Text style={globalStyles.buttonText}>
                {isRequestingCallScreeningRole
                  ? "Aguardando confirmação..."
                  : "Ativar bloqueio de chamadas"}
              </Text>
            </TouchableOpacity>
          ) : null}
      {Platform.OS === "android" ? (
        <>
          {callPermissionBlocked || smsPermissionBlocked ? (
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => {
                void Linking.openSettings();
              }}
              style={globalStyles.button}
            >
              <Text style={globalStyles.buttonText}>
                Abrir configurações do app
              </Text>
            </TouchableOpacity>
          ) : null}
        </>
      ) : null}
      <TouchableOpacity onPress={() => router.push("/denuncia")} style={globalStyles.button}>
        <Text style={globalStyles.buttonText}>Denúncia</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => router.push("/conta")} style={globalStyles.button}>
        <Text style={globalStyles.buttonText}>Gerenciar conta</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => router.push("/historico")} style={globalStyles.button}>
        <Text style={globalStyles.buttonText}>Histórico de chamadas</Text>
      </TouchableOpacity>
    </View>
  );
}