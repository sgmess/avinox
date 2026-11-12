import "server-only";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

// On App Hosting the Admin SDK picks up the project and credentials from the
// environment. Locally, point FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST
// at the emulators, or set GOOGLE_APPLICATION_CREDENTIALS.
const app = getApps()[0] ?? initializeApp();

export const adminAuth = getAuth(app);
export const db = getFirestore(app);

// One document per rider holding their settings, with each ride's summary in
// `rides`, its thinned route and graphs in `tracks`, and a few kB of that route
// in `shapes` for the pages that look across every ride. Only the server reads them.
export const userDoc = (uid: string) => db.collection("riders").doc(uid);
export const ridesCol = (uid: string) => userDoc(uid).collection("rides");
export const tracksCol = (uid: string) => userDoc(uid).collection("tracks");
export const shapesCol = (uid: string) => userDoc(uid).collection("shapes");
