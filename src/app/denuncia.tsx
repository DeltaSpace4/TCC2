import * as Clipboard from "expo-clipboard";
import { Link } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Platform, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { getSmsLinkReports, syncIncomingSmsWithLinks, type SmsLinkReport } from "../services/SMS";
import { getShortIncomingCalls, type ShortIncomingCall } from "../services/SPAM";
import { globalStyles } from "../styles/global";

export default function Denuncia() {
  const [calls, setCalls] = useState<ShortIncomingCall[]>([]);
  const [smsReports, setSmsReports] = useState<SmsLinkReport[]>([]);
  const [smsPermissionGranted, setSmsPermissionGranted] = useState<boolean | null>(null);
  const [reportTimestamp, setReportTimestamp] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const fetchReports = useCallback(async () => {
    const fetchedAt = Date.now();
    const smsSyncResult =
      Platform.OS === "android" ? await syncIncomingSmsWithLinks() : null;
    const [loadedCalls, loadedSmsReports] = await Promise.all([
      getShortIncomingCalls(),
      getSmsLinkReports(),
    ]);

    return {
      calls: loadedCalls,
      smsReports: loadedSmsReports,
      smsPermissionGranted: smsSyncResult?.permissionGranted ?? null,
      fetchedAt,
    };
  }, []);

  const loadReports = useCallback(async () => {
    setIsLoading(true);
    setHasError(false);

    try {
      const reports = await fetchReports();
      setCalls(reports.calls);
      setSmsReports(reports.smsReports);
      setSmsPermissionGranted(reports.smsPermissionGranted);
      setReportTimestamp(reports.fetchedAt);
    } catch (error) {
      console.error("Erro ao carregar dados para a denúncia:", error);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, [fetchReports]);

  useEffect(() => {
    let isActive = true;

    const loadInitialReports = async () => {
      try {
        const reports = await fetchReports();
        if (isActive) {
          setCalls(reports.calls);
          setSmsReports(reports.smsReports);
          setSmsPermissionGranted(reports.smsPermissionGranted);
          setReportTimestamp(reports.fetchedAt);
        }
      } catch (error) {
        console.error("Erro ao carregar dados para a denúncia:", error);
        if (isActive) {
          setHasError(true);
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };

    void loadInitialReports();
    return () => {
      isActive = false;
    };
  }, [fetchReports]);

  const oneWeekAgo = reportTimestamp - 7 * 24 * 60 * 60 * 1000;
  const callsFromLastWeek = calls.filter(
    (call) =>
      call.callTimestamp >= oneWeekAgo &&
      call.callTimestamp <= reportTimestamp,
  );
  const callsByNumber = Array.from(
    callsFromLastWeek.reduce((groupedCalls, call) => {
      const normalizedNumber =
        call.phoneNumber.replace(/\D/g, "") ||
        call.phoneNumber.trim().toLocaleLowerCase();
      const existingCall = groupedCalls.get(normalizedNumber);

      if (existingCall) {
        existingCall.count += 1;
      } else {
        groupedCalls.set(normalizedNumber, {
          phoneNumber: call.phoneNumber,
          count: 1,
        });
      }

      return groupedCalls;
    }, new Map<string, { phoneNumber: string; count: number }>()),
  )
    .map(([, call]) => call)
    .sort(
      (firstCall, secondCall) =>
        secondCall.count - firstCall.count ||
        firstCall.phoneNumber.localeCompare(secondCall.phoneNumber),
    );

  const smsReportsBySender = Array.from(
    smsReports.reduce((groupedReports, report) => {
      const sender = report.sender.trim() || "Desconhecido";
      const normalizedSender =
        sender.replace(/\D/g, "") || sender.toLocaleLowerCase();
      const existingReport = groupedReports.get(normalizedSender);
      const uniqueLinks = report.links
        .map((link) => link.trim())
        .filter(Boolean);

      if (existingReport) {
        existingReport.messageCount += 1;
        uniqueLinks.forEach((link) => existingReport.links.add(link));
      } else {
        groupedReports.set(normalizedSender, {
          sender,
          messageCount: 1,
          links: new Set(uniqueLinks),
        });
      }

      return groupedReports;
    }, new Map<string, { sender: string; messageCount: number; links: Set<string> }>()),
  ).map(([, report]) => report);

  const reportText =
    callsByNumber.length > 0
      ? [
          "Relato de ligações recebidas suspeitas de SPAM na última semana",
          "",
          `Foram identificadas ${callsFromLastWeek.length} ligações suspeitas de SPAM nesta semana tendo uma duração inferior a 7 segundos`,
          ...callsByNumber.map(
            (call, index) =>
              `${index + 1}. ${call.phoneNumber} — ${call.count} ${call.count === 1 ? "ligação" : "ligações"}`,
          ),
          "",
          "Solicito a análise e apuração dessas ligações.",
        ].join("\n")
      : "Nenhuma ligação recebida de curta duração foi encontrada nos últimos 7 dias.";
  
  async function copyToClipboard() {
    try {
      await Clipboard.setStringAsync(reportText);
    } catch (error) {
      console.error("Erro ao copiar a denúncia:", error);
      Alert.alert("Erro", "Não foi possível copiar a denúncia. Tente novamente.");
    }
  }

  return (
    <View style={globalStyles.container}>
      <Text style={globalStyles.title}>Denúncia</Text>
      <ScrollView
        style={globalStyles.scrollView}
        contentContainerStyle={globalStyles.content}
      >
        {isLoading ? (
          <Text style={globalStyles.empty}>Carregando denúncias...</Text>
        ) : hasError ? (
          <Text style={globalStyles.empty}>
            Não foi possível carregar os dados da denúncia. Tente novamente.
          </Text>
        ) : (
          <>
            <Text style={globalStyles.count}>
              Ligações de curta duração na última semana: {callsFromLastWeek.length}
            </Text>
            <Text selectable style={globalStyles.report}>
              {reportText}
            </Text>
            <Text style={globalStyles.sectionTitle}>
              Mensagens com links: {smsReportsBySender.length}
            </Text>
            {Platform.OS === "android" && smsPermissionGranted === false ? (
              <Text style={globalStyles.empty}>
                Permita o acesso às mensagens para verificar links recebidos.
              </Text>
            ) : smsReportsBySender.length === 0 ? (
              <Text style={globalStyles.empty}>
                Nenhuma mensagem recebida com links foi encontrada.
              </Text>
            ) : (
              smsReportsBySender.map((report) => (
                <Text
                  key={report.sender}
                  selectable
                  style={[globalStyles.report, { marginBottom: 16 }]}
                >
                  {`Numero: ${report.sender} enviou ${report.messageCount} ${report.messageCount === 1 ? "mensagem" : "mensagens"} contendo links.\nLinks encontrados:\n${Array.from(report.links).join("\n")}`}
                </Text>
              ))
            )}
          </>
        )}
        <TouchableOpacity
          accessibilityRole="button"
          disabled={isLoading}
          onPress={() => { void loadReports(); }}
          style={[globalStyles.button, globalStyles.refreshButton]}>
          <Text style={globalStyles.buttonText}>
            {isLoading ? "Carregando..." : "Atualizar denúncia"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          disabled={isLoading}
          onPress={() => void copyToClipboard()}
          style={[globalStyles.buttonLink]}>
          <Text style={globalStyles.buttonText}>Copiar denúncia</Text>
        </TouchableOpacity>
        <Link href="https://apps.anatel.gov.br/anatelconsumidor/SolicitacaoRegistrarIniciar.aspx" style={[globalStyles.buttonLink]}>
          <Text style={globalStyles.buttonText}>Ir para o site da Anatel</Text>
        </Link>
      </ScrollView>
    </View>
  );
}