import crypto from 'crypto';

// Function to generate a random string of specified length
export function generateRandomString(length: number): string {
  if (length <= 0) {
    throw new Error("Length must be greater than 0");
  }

  // Generate random bytes and convert to base64
  const randomBytes = crypto.randomBytes(Math.ceil(length / 2));
  const randomString = randomBytes.toString('hex');

  // Return the string truncated to the desired length
  return randomString.slice(0, length);
}