import forge from 'node-forge';
import crypto from 'crypto';

const secretKey = "FLWSECK-f053378a95d4cf6a2822b593e4907af9-198c2ce438evt-X";
const md5 = crypto.createHash('md5').update(secretKey).digest('hex');
const last12 = md5.substring(md5.length - 12).toLowerCase();
const first12 = secretKey.replace('FLWSECK-', '').replace('FLWSECK_TEST-', '').substring(0, 12);
const encryptionKey = `${first12}${last12}`;
console.log("Key:", encryptionKey, "Length:", encryptionKey.length);

const text = JSON.stringify({ card_number: "123456789" });
const cipher = forge.cipher.createCipher('3DES-ECB', forge.util.createBuffer(encryptionKey));
cipher.start({iv: ''});
cipher.update(forge.util.createBuffer(text, 'utf-8'));
cipher.finish();
const encrypted = forge.util.encode64(cipher.output.getBytes());
console.log("Encrypted:", encrypted);

