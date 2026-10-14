const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const cloudStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: 'ycce-app',
    resource_type: 'raw',
    public_id: `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`,
    format: undefined,
  }),
});

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`),
});

// Start on disk so uploads always work, then switch to Cloudinary only once its
// credentials are confirmed valid — invalid keys otherwise fail every upload.
let cloudinaryUsable = false;

cloudinary.api.ping()
  .then(() => {
    cloudinaryUsable = true;
    console.log('Cloudinary connected — uploads go to Cloudinary');
  })
  .catch((err) => {
    const reason = err?.error?.message || err?.message || 'unknown error';
    console.warn(`Cloudinary unavailable (${reason}) — uploads saved to ./uploads, served from /uploads`);
  });

// Controllers read `req.file.path` as the public URL. Cloudinary already returns
// one; a disk path has to be rewritten into a URL the app can actually open.
const toPublicUrl = (req, info) => ({
  ...info,
  path: `${req.protocol}://${req.get('host')}/uploads/${info.filename}`,
});

// Choose storage per request so the choice reflects the ping result.
const storage = {
  _handleFile(req, file, cb) {
    const useDisk = (e, info) => (e ? cb(e) : cb(null, toPublicUrl(req, info)));
    if (!cloudinaryUsable) return diskStorage._handleFile(req, file, useDisk);
    return cloudStorage._handleFile(req, file, (err, info) => {
      if (err) {
        // Credentials went stale mid-run; fall back rather than lose the upload.
        cloudinaryUsable = false;
        return diskStorage._handleFile(req, file, useDisk);
      }
      return cb(null, info);
    });
  },
  _removeFile(req, file, cb) {
    const active = cloudinaryUsable ? cloudStorage : diskStorage;
    return active._removeFile(req, file, cb);
  },
};

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

module.exports = { cloudinary, upload, UPLOAD_DIR };
