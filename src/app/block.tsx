import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { addBlockedNumber, getBlockedNumbers, removeBlockedNumber, type BlockedNumber } from "../services/SPAM";
import { colors, globalStyles } from "../styles/global";

export default function Block() {
  const [blockedNumbers, setBlockedNumbers] = useState<BlockedNumber[]>([]);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const loadBlockedNumbers = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");

    try {
      setBlockedNumbers(await getBlockedNumbers());
    } catch (error) {
      console.error("Erro ao carregar números bloqueados:", error);
      setErrorMessage("Não foi possível carregar os números bloqueados.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isActive = true;

    void getBlockedNumbers()
      .then((numbers) => {
        if (isActive) {
          setBlockedNumbers(numbers);
        }
      })
      .catch((error: unknown) => {
        console.error("Erro ao carregar números bloqueados:", error);
        if (isActive) {
          setErrorMessage("Não foi possível carregar os números bloqueados.");
        }
      })
      .finally(() => {
        if (isActive) {
          setIsLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, []);

  const handleAddNumber = async () => {
    if (!phoneNumber.trim()) {
      setErrorMessage("Informe um número de telefone.");
      return;
    }

    setIsSaving(true);
    setErrorMessage("");
    try {
      await addBlockedNumber(phoneNumber);
      setPhoneNumber("");
      setBlockedNumbers(await getBlockedNumbers());
    } catch (error) {
      console.error("Erro ao adicionar número bloqueado:", error);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível adicionar o número.",
      );
      try {
        setBlockedNumbers(await getBlockedNumbers());
      } catch (refreshError) {
        console.error("Erro ao atualizar números bloqueados:", refreshError);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleUnblockNumber = async (number: BlockedNumber) => {
    setIsSaving(true);
    setErrorMessage("");
    try {
      await removeBlockedNumber(number.id);
      setBlockedNumbers((currentNumbers) =>
        currentNumbers.filter((currentNumber) => currentNumber.id !== number.id),
      );
    } catch (error) {
      console.error("Erro ao desbloquear número:", error);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível desbloquear o número.",
      );
      try {
        setBlockedNumbers(await getBlockedNumbers());
      } catch (refreshError) {
        console.error("Erro ao atualizar números bloqueados:", refreshError);
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={globalStyles.container}>
      <Text style={globalStyles.title}>Números bloqueados</Text>
      <Text style={styles.description}>
        Adicione números manualmente ou desbloqueie números identificados como
        suspeitos. Números globais vêm bloqueados por padrão; desbloqueá-los
        afeta somente esta conta.
      </Text>

      <View style={styles.addRow}>
        <TextInput
          accessibilityLabel="Número de telefone para bloquear"
          autoComplete="tel"
          keyboardType="phone-pad"
          onChangeText={setPhoneNumber}
          onSubmitEditing={() => void handleAddNumber()}
          placeholder="(99) 99999-9999"
          placeholderTextColor={colors.textSecondary}
          returnKeyType="done"
          style={styles.input}
          value={phoneNumber}
        />
        <TouchableOpacity
          accessibilityRole="button"
          disabled={isSaving}
          onPress={() => void handleAddNumber()}
          style={[styles.addButton, isSaving && styles.disabledButton]}
        >
          <Text style={globalStyles.buttonText}>
            {isSaving ? "Salvando..." : "Bloquear"}
          </Text>
        </TouchableOpacity>
      </View>

      {errorMessage ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {errorMessage}
        </Text>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        style={styles.list}
      >
        {isLoading ? (
          <Text style={globalStyles.empty}>Carregando números...</Text>
        ) : blockedNumbers.length === 0 ? (
          <Text style={globalStyles.empty}>Nenhum número bloqueado.</Text>
        ) : (
          blockedNumbers.map((number) => (
            <View key={number.id} style={styles.numberRow}>
              <View style={styles.numberDetails}>
                <Text selectable style={styles.phoneNumber}>
                  {number.phoneNumber}
                </Text>
                {number.occurrences > 0 ? (
                  <Text style={styles.occurrences}>
                    {number.occurrences} chamadas curtas
                  </Text>
                ) : null}
              </View>
              <TouchableOpacity
                accessibilityLabel={`Desbloquear ${number.phoneNumber}`}
                accessibilityRole="button"
                disabled={isSaving}
                onPress={() => void handleUnblockNumber(number)}
                style={[styles.removeButton, isSaving && styles.disabledButton]}
              >
                <Text style={styles.removeButtonText}>Desbloquear</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </ScrollView>

      <TouchableOpacity
        accessibilityRole="button"
        disabled={isSaving || isLoading}
        onPress={() => void loadBlockedNumbers()}
        style={[styles.secondaryButton, (isSaving || isLoading) && styles.disabledButton]}
      >
        <Text style={globalStyles.buttonText}>Atualizar lista</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  description: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 12,
    textAlign: "center",
  },
  addRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 20,
    width: "100%",
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: "gray",
    borderRadius: 8,
    borderWidth: 1,
    color: colors.text,
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  addButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 14,
  },
  disabledButton: {
    opacity: 0.6,
  },
  error: {
    color: colors.alert,
    fontSize: 14,
    marginTop: 12,
    width: "100%",
  },
  list: {
    flex: 1,
    marginTop: 16,
    width: "100%",
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: 8,
  },
  numberRow: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
    minHeight: 64,
    padding: 12,
  },
  numberDetails: {
    flex: 1,
    paddingRight: 8,
  },
  phoneNumber: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
  },
  occurrences: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 4,
  },
  removeButton: {
    alignItems: "center",
    borderColor: colors.alert,
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 10,
  },
  removeButtonText: {
    color: colors.alert,
    fontSize: 12,
    fontWeight: "600",
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 8,
    justifyContent: "center",
    marginTop: 10,
    marginBottom: 30,
    minHeight: 44,
    width: "100%",
  },
  platformNote: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 8,
    textAlign: "center",
  },
});
