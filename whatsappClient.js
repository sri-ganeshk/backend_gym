// whatsappClient.js
import {  makeWASocket, DisconnectReason, useMultiFileAuthState } from 'baileys';
import qrcode from 'qrcode-terminal';
 

let client;

/**
 * Initializes the WhatsApp client and prints the QR code to the terminal.
 */
export async function initializeWhatsAppClient() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");

    client = makeWASocket({
      printQRInTerminal: false, // Disable default printing, we'll handle it with qrcode-terminal
      auth: state,
    });

    client.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update || {};
      if (qr) {
        // Generate and display QR code in the terminal
        qrcode.generate(qr, { small: true });
        console.log("Scan the QR code above with your WhatsApp app to login.");
      }
      if (connection === "open") {
        console.log("Connected to WhatsApp!");
      }
      if (connection === "close") {
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          console.log("Connection closed. Attempting to reconnect in 3 seconds...");
          setTimeout(() => {
            initializeWhatsAppClient();
          }, 3000);
        } else {
          console.log("Logged out from WhatsApp. Please scan the QR again to reconnect.");
        }
      }
    });

    client.ev.on("creds.update", saveCreds);
    return client;
  } catch (err) {
    console.error("Error connecting to WhatsApp:", err);
    throw err;
  }
}

/**
 * Returns the initialized WhatsApp client.
 */
export function getWhatsAppClient() {
  if (!client) {
    throw new Error("WhatsApp client is not initialized");
  }
  return client;
}
