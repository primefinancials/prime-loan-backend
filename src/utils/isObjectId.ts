import { Types} from 'mongoose';
/**
 * To check if a string is a valid ObjectId
 */

export const isObjectId = (id: string | Types.ObjectId) => {
    return Types.ObjectId.isValid(id);
};