import CryptoJS from 'crypto-js';
import {CRYPTOJS_KEY} from '../config';

export const decodePassword = (password: string) => {
    const decrypted = CryptoJS.AES.decrypt(
        password,
        String(CRYPTOJS_KEY)
    ).toString(CryptoJS.enc.Utf8)

    return decrypted
}

export const encryptPassword = (password: string) => {
    const encrypted = CryptoJS.AES.encrypt(
        password,
        String(CRYPTOJS_KEY)
    ).toString();

    return encrypted
}
