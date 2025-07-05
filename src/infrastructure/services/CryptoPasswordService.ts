import CryptoJS from 'crypto-js';
import { IPasswordService } from '../../core/services/IPasswordService';
import { CRYPTOJS_KEY } from '../../config';

export class CryptoPasswordService implements IPasswordService {
  async hash(password: string): Promise<string> {
    return CryptoJS.AES.encrypt(password, String(CRYPTOJS_KEY)).toString();
  }

  async verify(password: string, hashedPassword: string): Promise<boolean> {
    const decrypted = CryptoJS.AES.decrypt(hashedPassword, String(CRYPTOJS_KEY)).toString(CryptoJS.enc.Utf8);
    return password === decrypted;
  }
}