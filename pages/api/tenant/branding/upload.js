import { requireTenantUser, requirePermission, getServiceClient } from '../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../lib/permissions';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';

// Disable Next.js body parsing — formidable handles it
export const config = { api: { bodyParser: false } };

/**
 * POST /api/tenant/branding/upload
 *
 * Uploads a logo image to Supabase Storage and updates tenant_settings.
 * Accepts multipart form data with:
 *   - file: the image file
 *   - key: 'logo_small' or 'logo_large'
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.SETTINGS, PERMISSIONS.ALL], res)) return;

  const svc = getServiceClient();

  try {
    // Parse multipart form
    const form = formidable({ maxFileSize: 2 * 1024 * 1024 });
    const [fields, files] = await form.parse(req);

    const key = fields.key?.[0] || fields.key;
    if (!key || !['logo_small', 'logo_large'].includes(key)) {
      return res.status(400).json({ error: 'Invalid key. Must be logo_small or logo_large.' });
    }

    const file = files.file?.[0] || files.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    // Read file
    const filePath = file.filepath || file.path;
    const fileBuffer = fs.readFileSync(filePath);
    const ext = path.extname(file.originalFilename || file.newFilename || 'image.png').toLowerCase() || '.png';
    const contentType = file.mimetype || 'image/png';

    // Upload to Supabase Storage
    const storagePath = `${ctx.tenantId}/${key}${ext}`;
    const bucket = 'branding';

    // Ensure bucket exists (create if needed — idempotent)
    try {
      await svc.storage.createBucket(bucket, { public: true, fileSizeLimit: 2097152 });
    } catch { /* bucket likely exists */ }

    const { data, error: uploadError } = await svc.storage
      .from(bucket)
      .upload(storagePath, fileBuffer, {
        contentType,
        upsert: true, // overwrite if exists
      });

    if (uploadError) {
      return res.status(500).json({ error: `Upload failed: ${uploadError.message}` });
    }

    // Get public URL
    const { data: { publicUrl } } = svc.storage.from(bucket).getPublicUrl(storagePath);

    // Update tenant_settings
    const settingsField = key === 'logo_small' ? 'logo_small_url' : 'logo_large_url';
    await svc
      .from('tenant_settings')
      .update({ [settingsField]: publicUrl, updated_at: new Date().toISOString() })
      .eq('tenant_id', ctx.tenantId);

    // Clean up temp file
    try { fs.unlinkSync(filePath); } catch {}

    return res.status(200).json({ url: publicUrl });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Upload failed' });
  }
}
