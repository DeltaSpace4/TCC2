import { useCallback, useEffect, useState } from "react";
import { Platform, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { getSmsLinkReports, syncIncomingSmsWithLinks, type SmsLinkReport } from "../services/SMS";
import { getShortIncomingCalls, type ShortIncomingCall } from "../services/SPAM";
import { globalStyles } from "../styles/global";

export default function Historico() {
  const [calls, setCalls] = useState<ShortIncomingCall[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [smsReports, setSmsReports] = useState<SmsLinkReport[]>([]);

  const loadCalls = useCallback(async () => {
    setIsLoading(true);
    setHasError(false);

    try {
      setCalls(await getShortIncomingCalls());
    } catch (error) {
      console.error("Erro ao carregar chamadas para o histórico:", error);
      setHasError(true);
    }

    try {
      if (Platform.OS === "android") {
        await syncIncomingSmsWithLinks();
      }
      setSmsReports(await getSmsLinkReports());
    } catch (error) {
      console.error("Erro ao carregar relatórios de SMS para o histórico:", error);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isActive = true;

    const loadInitialCalls = async () => {
      try {
        const loadedCalls = await getShortIncomingCalls();
        if (isActive) {
          setCalls(loadedCalls);
        }
      } catch (error) {
        console.error("Erro ao carregar chamadas para o histórico:", error);
        if (isActive) {
          setHasError(true);
        }
      }
    };

    const loadInitialSmsReports = async () => {
      try {
        if (Platform.OS === "android") {
          await syncIncomingSmsWithLinks();
        }
        const loadedSmsReports = await getSmsLinkReports();
        if (isActive) {
          setSmsReports(loadedSmsReports);
        }
      } catch (error) {
        console.error("Erro ao carregar relatórios de SMS para o histórico:", error);
        if (isActive) {
          setHasError(true);
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };

    void loadInitialCalls();
    void loadInitialSmsReports();
    return () => {
      isActive = false;
    };
  }, []);

  return (
    <View style={globalStyles.container}>
      <Text style={globalStyles.title}>Histórico de chamadas</Text>
      <ScrollView
        style={globalStyles.scrollView}
        contentContainerStyle={globalStyles.content}
      >
        {isLoading ? (
          <Text style={globalStyles.empty}>Carregando chamadas...</Text>
        ) : hasError ? (
          <Text style={globalStyles.empty}>
            Não foi possível carregar as chamadas. Tente novamente.
          </Text>
        ) : (
          <>
            <Text style={globalStyles.count}>
              Chamadas registradas: {calls.length}
            </Text>
            <Text selectable style={globalStyles.report}>
              {calls.map((call, index) => (
                <Text key={index}>
                  {index + 1}. {call.phoneNumber} - {call.durationSeconds} segundos - {new Date(call.callTimestamp).toLocaleString()}
                  {"\n"}
                </Text>
              ))}
            </Text>
            <Text style={globalStyles.count}>
              Links registrados: {smsReports.length}
            </Text>
            <Text selectable style={globalStyles.report}>
              {smsReports.map((report, index) => (
                <Text key={index}>
                  {index + 1}. {report.sender|| "Desconhecido"} - {report.links.join(", ")}
                  {"\n"}
                </Text>
              ))}
            </Text>
          </>
        )}
        <TouchableOpacity
          accessibilityRole="button"
          disabled={isLoading}
          onPress={() => {
            void loadCalls();
          }}
          style={[globalStyles.button, globalStyles.refreshButton]}
        >
          <Text style={globalStyles.buttonText}>
            {isLoading ? "Carregando..." : "Atualizar histórico"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}