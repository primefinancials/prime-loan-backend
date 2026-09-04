/**
 * Multipart file-upload middleware (multer).
 *
 * The chat attachment endpoint (`POST /chat/upload`) reads `req.file`, but no
 * middleware ever populated it, so every admin/user attachment upload returned
 * "No file uploaded". This wires multer with disk storage into the OS temp dir -
 * `UploadService.uploadFile` streams the file to Cloudinary and then unlinks the
 * local copy, so nothing lingers on disk.
 */
import multer from "multer";
import os from "os";
import path from "path";
import fs from "fs";
import crypto from "crypto";

const TMP_DIR = path.join(os.tmpdir(), "prime-uploads");
try {
  fs.mkdirSync(TMP_DIR, { recursive: true });
} catch {
  /* best effort - multer will surface a clear error if the dir is unusable */
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, TMP_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").slice(0, 12);
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`);
  },
});

const ALLOWED = /^(image\/|video\/|audio\/|application\/pdf$|application\/msword|application\/vnd\.openxmlformats|text\/plain$)/;

export const uploadSingle = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024, files: 1 }, // 25 MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED.test(file.mimetype)) return cb(null, true);
    cb(new Error("Unsupported file type"));
  },
}).single("file");

/**
 * Express handler wrapper so a multer error becomes a clean 400 instead of
 * bubbling to the generic error handler as a 500.
 */
export function chatUpload(req: any, res: any, next: any) {
  uploadSingle(req, res, (err: any) => {
    if (err) {
      return res.status(400).json({ status: "error", message: err.message || "Upload failed" });
    }
    next();
  });
}
