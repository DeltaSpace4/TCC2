import { StyleSheet } from 'react-native';

export const colors = {
  background: '#0a0a0a',
  header: '#242444',
  surface: '#2a2a4a',
  primary: '#1d00fc',
  text: '#ffffff',
  textSecondary: '#a0a0b0',
  alert: '#ff5252',
};

export const globalStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: 60,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.text,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 30,
    marginBottom: 16,
  },
  empty: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  button: {
    marginTop: 10,
    padding: 10,
    backgroundColor: colors.primary,
    width: "30%",
    alignItems: "center",
  },
  buttonLink:{
    marginTop: 10,
    padding: 10,
    backgroundColor: colors.primary,
    width: "100%",
    alignItems: "center",
    textAlign: "center",
  },
  buttonText: {
    color: colors.text,
    fontWeight: 'bold',
  },
  textInput: {
    marginTop: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: "gray",
    width: "80%",
    color: colors.text,
    backgroundColor: colors.surface,
  },
  placeholderText: {
    color: colors.textSecondary,
  },
  scrollView: {
    width: "100%",
    marginTop: 20,
  },
  content: {
    flexGrow: 1,
    alignItems: "stretch",
    paddingBottom: 24,
  },
  count: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
  },
  report: {
    color: "#ffffff",
    fontSize: 16,
    lineHeight: 24,
  },
  refreshButton: {
    width: "100%",
    marginTop: 20,
  },
});