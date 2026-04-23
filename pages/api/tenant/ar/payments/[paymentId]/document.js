import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../../lib/tenant-api';
import { getSignedUrl } from '../../../../../../lib/pdf/storage';
import { PERMISSIONS } from '../../../../../../lib/permissions';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';

// Disable Next's body parser — formidable handles multipart.
export const config = {
  runtime: 'nodejs',
  api: { bodyParser: false },
};

const BUCKET = 'documents';
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg']);
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
]);

/**
 * /api/tenant/ar/payments/[paymentId]/document
 *
 *   POST   — upload a supporting document (check scan, wire confirmation,
 *            ACH receipt). Multipart form with a single `file` field.
 *            Stores in Storage bucket `documents` at
 *            `{tenantId}/payments/{paymentId}-{timestamp}.{ext}`. The
 *            timestamp makes each upload a unique key so re-uploading
 *            does NOT overwrite the prior doc — storage is append-only
 *            by convention for evidence retention. The payment row's
 *            document_url is updated to point at the new key; prior
 *            bytes remain accessible at their stored path for audit.
 *
 *   GET    — returns a 15-min signed URL for the currently-pointed-at
 *            document. Caller can fetch JSON { url, filename } or follow
 *            ?redirect=1 for a 302 into the signed URL.
 *
 *   DELETE — clears document_url/document_filename on the payment row.
 *            Does NOT remove the Storage file — prior uploads are
 *            retained as evidence. The UI stops surfacing the doc but
 *            the bytes are still in the bucket if audit needs them.
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL], res)) return;

  const { paymentId } = req.query;
  const svc = getServiceClient();

  // Verify payment exists and belongs to this tenant before any mutation
  // or file access. Prevents tenant A from reading/writing tenant B's doc
  // by guessing payment IDs.
  const { data: payment, error: payErr } = await svc
    .from('payments_received')
    .select('id, document_url, document_filename')
    .eq('id', paymentId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (payErr) return res.status(500).json({ error: payErr.message });
  if (!payment) return res.status(404).json({ error: 'Payment not found' });

  if (req.method === 'POST') {
    try {
      const form = formidable({ maxFileSize: MAX_BYTES });
      const [, files] = await form.parse(req);
      const file = files.file?.[0] || files.file;
      if (!file) return res.status(400).json({ error: 'No file uploaded' });

      const originalName = file.originalFilename || file.newFilename || 'document';
      const ext = (path.extname(originalName) || '').toLowerCase();
      if (!ALLOWED_EXT.has(ext)) {
        return res.status(400).json({ error: `File type ${ext || '(none)'} not allowed. PDF, PNG, JPG only.` });
      }
      const mime = file.mimetype || 'application/octet-stream';
      if (!ALLOWED_MIME.has(mime)) {
        return res.status(400).json({ error: `Content-Type ${mime} not allowed. PDF, PNG, JPG only.` });
      }

      const filePath = file.filepath || file.path;
      try {
        const buffer = fs.readFileSync(filePath);

        // Timestamp in the path makes every upload a fresh key. Re-uploading
        // a replacement doc writes a new file rather than overwriting —
        // previous bytes are preserved in the bucket at their original
        // path for audit/evidence retention. upsert:false protects against
        // accidental same-ms collisions (shouldn't happen but belt-and-
        // suspenders).
        const storagePath = `${ctx.tenantId}/payments/${paymentId}-${Date.now()}${ext}`;
        const { error: uploadErr } = await svc.storage
          .from(BUCKET)
          .upload(storagePath, buffer, { contentType: mime, upsert: false });
        if (uploadErr) return res.status(500).json({ error: `Upload failed: ${uploadErr.message}` });

        const { error: updErr } = await svc
          .from('payments_received')
          .update({
            document_url: storagePath,
            document_filename: originalName,
          })
          .eq('id', paymentId)
          .eq('tenant_id', ctx.tenantId);
        if (updErr) return res.status(500).json({ error: `DB update failed: ${updErr.message}` });

        return res.status(200).json({
          document_url: storagePath,
          document_filename: originalName,
        });
      } finally {
        // Clean up the formidable temp file on every exit path — success,
        // Storage failure, DB failure, or unexpected throw. Wrapped in its
        // own try/catch because unlink failures are non-fatal (OS will
        // sweep temp dirs anyway, and the real error is already surfaced).
        try { fs.unlinkSync(filePath); } catch {}
      }
    } catch (e) {
      return res.status(500).json({ error: e.message || 'Upload failed' });
    }
  }

  if (req.method === 'GET') {
    if (!payment.document_url) return res.status(404).json({ error: 'No document attached' });
    try {
      // Pass explicit TTL (15 min) rather than relying on getSignedUrl's
      // default so a future default change in lib/pdf/storage.js doesn't
      // silently extend the lifetime of sensitive payment docs.
      const signedUrl = await getSignedUrl(svc, payment.document_url, 900);
      if (req.query.redirect === '1') {
        res.writeHead(302, { Location: signedUrl });
        return res.end();
      }
      return res.status(200).json({ url: signedUrl, filename: payment.document_filename });
    } catch (e) {
      return res.status(500).json({ error: e.message || 'Signed URL generation failed' });
    }
  }

  if (req.method === 'DELETE') {
    if (!payment.document_url) return res.status(200).json({ ok: true });
    // Clear the row reference only. The Storage file itself is retained
    // for evidence/audit purposes — customer docs (check scans, wire
    // confirmations, ACH receipts) may be subject to later discovery or
    // regulatory review. The UI stops surfacing the doc (no paperclip
    // icon, no click-through) but the bytes remain at their stored path.
    // If a future workflow needs a true erase (e.g., GDPR deletion
    // request), that should be a separate privileged admin action.
    const { error: updErr } = await svc
      .from('payments_received')
      .update({ document_url: null, document_filename: null })
      .eq('id', paymentId)
      .eq('tenant_id', ctx.tenantId);
    if (updErr) return res.status(500).json({ error: updErr.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
