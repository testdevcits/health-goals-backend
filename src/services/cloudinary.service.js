const crypto = require('crypto');
const env = require('../config/env');
const { AppError } = require('../middleware/error.middleware');

const uploadImage = async (dataUri, publicId, label) => {
  const { cloudName, apiKey, apiSecret, folder } = env.cloudinary;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new AppError('Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in backend/.env.', 503);
  }
  if (typeof dataUri !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(dataUri)) {
    throw new AppError('Provide a JPEG, PNG, or WebP image as a base64 data URI', 400);
  }
  if (Buffer.byteLength(dataUri, 'utf8') > 6 * 1024 * 1024) throw new AppError(`${label} image must be smaller than 4.5 MB`, 413);
  const timestamp = Math.floor(Date.now() / 1000);
  const signatureParams = `folder=${folder}&overwrite=true&public_id=${publicId}&timestamp=${timestamp}`;
  const signature = crypto.createHash('sha1').update(signatureParams + apiSecret).digest('hex');
  const body = new URLSearchParams({
    file: dataUri, api_key: apiKey, timestamp: String(timestamp), folder,
    public_id: publicId, overwrite: 'true', signature
  });
  let response;
  try {
    response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
    });
  } catch {
    throw new AppError('Could not connect to Cloudinary. Please try again.', 502);
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || typeof result.secure_url !== 'string') {
    throw new AppError('Cloudinary could not upload the image. Check Cloudinary credentials and account settings.', 502);
  }
  return { url: result.secure_url, publicId: result.public_id };
};

const safeId = value => String(value).replace(/[^a-zA-Z0-9_-]/g, '');
const uploadProfileImage = (dataUri, userId) => uploadImage(dataUri, `user-${safeId(userId)}`, 'Profile');
const uploadGroupImage = (dataUri, groupId) => uploadImage(dataUri, `group-${safeId(groupId)}`, 'Group');

module.exports = { uploadProfileImage, uploadGroupImage };
