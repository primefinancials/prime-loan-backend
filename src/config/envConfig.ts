import path from 'path';
import { config } from 'dotenv';

((): void => {
  config({
    path: path.resolve(__dirname, '../..', '.env'),
  });
})();