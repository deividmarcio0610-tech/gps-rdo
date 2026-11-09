/*
 * Banco na nuvem (Firebase). Estes valores são públicos, como a chave de um site: eles vão
 * dentro do app e quem protege os dados são as regras do Firestore (firestore.rules).
 * O app só entra na conta quando `apiKey` estiver preenchido (console do Firebase, em
 * Configurações do projeto > Seus apps > Configuração do SDK).
 */
window.FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDo7NRdsxdtrW1a_1nr7TNwYrhJrljHUro',
  authDomain: 'rdogps.firebaseapp.com',
  projectId: 'rdogps',
  storageBucket: 'rdogps.firebasestorage.app',
  messagingSenderId: '652848475050',
  appId: '1:652848475050:web:c73fd9b45c8d9f7a5ad9d3',
  // true = emulador local (testes); também liga com "?emulador" no endereço
  emulador: false,
};
