import { Schema, model, SchemaTypes } from 'mongoose';
import { User } from '../interfaces';

const userSchema = new Schema<User>(
  {
    confirmation_sent_at: { type: String, required: false },
    confirmed_at: { type: String, required: false },
    email: {
      type: String,
      required: true,
      unique: true,
      validate: {
        validator: function (email: string) {
          const self = this as any;
          return new Promise((resolve, reject) => {
            if (!/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/.test(email)) {
              reject(new Error('Invalid email address'));
            } else {
              self.constructor.findOne({ email }, (err: any, existingUser: any) => {
                if (err) {
                  reject(err);
                } else if (existingUser) {
                  reject(new Error('Email already exists'));
                } else {
                  resolve(true);
                }
              });
            }
          });
        },
      },
    },
    password: { type: String, required: true },
    email_confirmed_at: { type: String, required: false },
    refresh_tokens: { type: [String], required: true },
    is_anonymous: { type: Boolean, required: true },
    last_sign_in_at: { type: String, required: false },
    phone: { type: String, required: false },
    role: { type: String, enum: ["user", "admin"], required: true },
    user_metadata: {
      bvn: { type: String, required: false },
      nin: { type: String, required: false },
      sub: { type: String, required: false },
      email: { type: String, required: false },
      phone: { type: String, required: false },
      surname: { type: String, required: false },
      wallet: { type: String, required: false },
      first_name: { type: String, required: false },
      dateOfBirth: { type: String, required: false },
      email_verified: { type: Boolean, required: false },
      phone_verified: { type: Boolean, required: false },
      accountNo: { type: String, required: false },
      address: { type: String, required: false },
      pin: { type: String, required: false },
      file: { type: String, required: false },
      profile_photo: { type: String, required: false },
      types: { type: String, required: false },
      verified_address: {
        type: String,
        enum: ["verified", "pending", "unverified"],
        required: false,
      },
    },
    is_super_admin: { type: Boolean, required: false, default: null },
  },
  { timestamps: true }
);

const User = model<User>('User', userSchema);

// Sync indexes with the database
(async () => {
  await User.syncIndexes();
})();

export default User;
