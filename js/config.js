// Firebase connection for sharing with the family.
// Leave as null to use the app on this device only.
// To share: follow README.md "Share with the family" and paste the config object
// Firebase gives you, e.g.
//
// export const firebaseConfig = {
//   apiKey: "AIza...",
//   authDomain: "our-family-recipes.firebaseapp.com",
//   projectId: "our-family-recipes",
//   storageBucket: "our-family-recipes.appspot.com",
//   messagingSenderId: "1234567890",
//   appId: "1:1234567890:web:abc123",
// };
//
// These values are not secrets: Firebase web config is meant to be public.
// Access is protected by Google sign-in plus firestore.rules.
export const firebaseConfig = null;
