import { router } from "expo-router";
import { signInWithEmailAndPassword } from "firebase/auth";
import { useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { auth } from "../../FirebaseConfig";
import { globalStyles } from "../styles/global";

export default function Login() {

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  
    const signIn = async () => {
      try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        if(userCredential.user) { router.push("/home"); }
      } catch (error) {
        console.error("Error signing in user:", error);
        if(email === "" || password === "") {
          alert("Preencha todos os campos antes de entrar.");
        }else{
          alert("Email ou senha incorretos, tente novamente.");
        }
      }
    };  
  

  return (
    <View style={globalStyles.container}>
      <Text style={globalStyles.title}>Welcome to the Login Screen</Text>
      <TextInput style={globalStyles.textInput}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        placeholderTextColor={globalStyles.placeholderText.color}
      />
      <TextInput style={globalStyles.textInput}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholderTextColor={globalStyles.placeholderText.color}
      />
      <TouchableOpacity onPress={signIn} style={globalStyles.button}>
        <Text style={globalStyles.buttonText}>Entrar</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.Cadastro} onPress={() => router.push("/cadastro")}>
        <Text style={globalStyles.buttonText}>Cadastrar</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.Cadastro} onPress={() => router.push("/block")}>
        <Text style={globalStyles.buttonText}>Gerenciar Bloqueios</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  Cadastro: {
    marginTop: 20,
    textAlign: 'center',
    color: '#ffffff',
  }
});