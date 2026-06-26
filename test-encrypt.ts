import crypto from 'crypto';
import forge from 'node-forge';

const secretKey = "FLWSECK_TEST-12345678901234567890123456789012-X";

// Flutterwave says the encryption key is derived from the secret key:
// 1. First 12 chars of secret key
// 2. "FLWSECK_TEST" -> length 12
// Wait, no: the encryption key is the MD5 hash of the secret key?
// No, the encryption key is derived as:
// first 12 characters of the secret key + the last 12 characters of the hex representation of the MD5 hash of the secret key.
function getKey(seckey: string): string {
    const md5 = crypto.createHash('md5').update(seckey).digest('hex');
    const last12 = md5.substr(-12).toLowerCase();
    const first12 = seckey.replace('FLWSECK-', '').replace('FLWSECK_TEST-', '').substr(0, 12);
    // Actually, Flutterwave docs say:
    // First 12 characters of the secret key + Last 12 characters of the MD5 hash of the secret key
    // wait, what?
    return "";
}

