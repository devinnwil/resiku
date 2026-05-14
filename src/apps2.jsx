// apps2.jsx — RESIKU.ONLINE Pembuat Label Pengiriman
// Alur: Menu Utama → Pilih Template → Isi Formulir + Pratinjau + Unduh
//
// Pratinjau sekarang DINAMIS — komponen Label* dirender langsung dari state
// formulir. Ekspor PDF menangkap clone Label di ukuran asli via html2canvas
// lalu menyematkannya ke jsPDF dengan format kertas yang sesuai.

import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

// ── Tokens ───────────────────────────────────────────────────────────────────
const C = {
  appBg: '#1f1f1f',
  chromeText: '#bfbfbf',
  canvas: '#f3f3f3',
  panel: '#ffffff',
  ink: '#111111',
  muted: '#94b1b4',
  disabled: '#b8c5c7',
  border: '#e7e7e7',
  red: '#d92020',
  hairline: '#1a1a1a',
  faint: '#9a9a9a',
};
const FONT = '"Mulish", system-ui, sans-serif';

const TEMPLATES = [
  { id: 'a6-standar', label: 'A6 Standar',              src: '/templates/a6-standar.png', aspect: '525 / 740', pageMm: [105, 148] },
  { id: 'a6-logo',    label: 'A6 Standar + Logo Brand', src: '/templates/a6-logo.png',    aspect: '525 / 740', pageMm: [105, 148] },
  { id: 'minimalis',  label: 'Minimalis',               src: '/templates/minimalis.png',  aspect: '1 / 1',     pageMm: [105, 105] },
];
const T = Object.fromEntries(TEMPLATES.map(t => [t.id, t]));

// Native pixel dimensions used to render the label at "design size".
// The visible preview scales this via CSS transform; PDF export captures
// the off-screen native clone for crisp output.
const BASE_DIMS = {
  'a6-standar': { w: 525, h: 740 },
  'a6-logo':    { w: 525, h: 740 },
  'minimalis':  { w: 525, h: 525 },
};

const CONTAINER_W = 520;
const SELECT_TPL_W = 960;    // 3 large thumbs in a row + bottom card
// Right-side template row matches SELECT_TPL_W so thumbs are the same size
// across both screens. 70 (padding) + 280 (left col) + 80 (gap) + 960 (right) = 1390
const MAIN_MENU_W = 1390;
const SPRING = { type: 'spring', stiffness: 260, damping: 30 };

// ── RESIKU.ONLINE brand glyph ─────────────────────────────────────────────────────
function ResikuMark({ size = 32 }) {
  return (
    <img
      src="/logo.jpg"
      alt="Resiku"
      width={size}
      height={size}
      style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0, display: 'block' }}
    />
  );
}

// ── Toggle switch ───────────────────────────────────────────────────────────
function Toggle({ checked, onChange }) {
  return (
    <motion.button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      whileTap={{ scale: 0.94 }}
      animate={{ backgroundColor: checked ? C.ink : '#d4d4d4' }}
      transition={{ duration: 0.18 }}
      style={{
        position: 'relative',
        width: 32, height: 18,
        border: 'none',
        cursor: 'pointer',
        padding: 0,
        flexShrink: 0,
      }}
    >
      <motion.span
        animate={{ left: checked ? 16 : 2 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        style={{
          position: 'absolute',
          top: 2,
          width: 14, height: 14,
          backgroundColor: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
        }}
      />
    </motion.button>
  );
}

// ── Template thumbnail (PNG sample, used for menu + selector + modal) ────────
function TemplateThumb({ variant }) {
  const t = T[variant];
  return (
    <img
      src={t.src}
      alt={t.label}
      draggable={false}
      style={{
        width: '100%',
        aspectRatio: t.aspect,
        objectFit: 'contain',
        backgroundColor: '#fff',
        display: 'block',
        userSelect: 'none',
      }}
    />
  );
}

// ── Form field row ──────────────────────────────────────────────────────────
function FormField({ label, field, onChange, type = 'text', placeholder, options }) {
  const enabled = field.enabled;
  const baseInput = {
    width: '100%',
    padding: '10px 12px',
    fontSize: 13,
    fontFamily: FONT,
    border: `1px solid ${C.border}`,
    borderRadius: 0,
    outline: 'none',
    backgroundColor: enabled ? '#fff' : '#f6f6f6',
    color: enabled ? C.ink : '#aaa',
    boxSizing: 'border-box',
  };
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <label style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: C.ink, textTransform: 'uppercase' }}>
          {label}
        </label>
        <Toggle checked={enabled} onChange={(v) => onChange({ ...field, enabled: v })} />
      </div>
      {type === 'textarea' ? (
        <textarea disabled={!enabled} value={field.value} onChange={e => onChange({ ...field, value: e.target.value })} placeholder={placeholder} rows={3}
          style={{ ...baseInput, resize: 'vertical', lineHeight: '18px' }} />
      ) : type === 'select' ? (
        <select disabled={!enabled} value={field.value} onChange={e => onChange({ ...field, value: e.target.value })} style={baseInput}>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input type={type} disabled={!enabled} value={field.value} onChange={e => onChange({ ...field, value: e.target.value })} placeholder={placeholder} style={baseInput} />
      )}
    </div>
  );
}

// ── Crop modal — pick a square region from a non-1:1 upload ─────────────────
function CropModal({ src, onCancel, onApply }) {
  const [imgInfo, setImgInfo] = useState(null);
  const [cropPos, setCropPos] = useState({ x: 0, y: 0 });
  const [dragOffset, setDragOffset] = useState(null);
  const containerRef = useRef(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const cropSize = Math.min(img.width, img.height);
      setImgInfo({ img, w: img.width, h: img.height, cropSize });
      setCropPos({
        x: (img.width - cropSize) / 2,
        y: (img.height - cropSize) / 2,
      });
    };
    img.src = src;
  }, [src]);

  let displayScale = 0, displayW = 0, displayH = 0, displayCropSize = 0, displayCropX = 0, displayCropY = 0;
  if (imgInfo) {
    const MAX_DISPLAY = 460;
    displayScale = Math.min(MAX_DISPLAY / imgInfo.w, MAX_DISPLAY / imgInfo.h, 1);
    displayW = imgInfo.w * displayScale;
    displayH = imgInfo.h * displayScale;
    displayCropSize = imgInfo.cropSize * displayScale;
    displayCropX = cropPos.x * displayScale;
    displayCropY = cropPos.y * displayScale;
  }

  const handleMouseDown = (e) => {
    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left - displayCropX,
      y: e.clientY - rect.top - displayCropY,
    });
  };

  useEffect(() => {
    if (!dragOffset || !imgInfo) return;
    const onMove = (e) => {
      const rect = containerRef.current.getBoundingClientRect();
      const dx = e.clientX - rect.left - dragOffset.x;
      const dy = e.clientY - rect.top - dragOffset.y;
      const newX = Math.max(0, Math.min(imgInfo.w - imgInfo.cropSize, dx / displayScale));
      const newY = Math.max(0, Math.min(imgInfo.h - imgInfo.cropSize, dy / displayScale));
      setCropPos({ x: newX, y: newY });
    };
    const onUp = () => setDragOffset(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragOffset, imgInfo, displayScale]);

  const handleApply = () => {
    if (!imgInfo) return;
    const canvas = document.createElement('canvas');
    canvas.width = imgInfo.cropSize;
    canvas.height = imgInfo.cropSize;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(
      imgInfo.img,
      cropPos.x, cropPos.y, imgInfo.cropSize, imgInfo.cropSize,
      0, 0, imgInfo.cropSize, imgInfo.cropSize
    );
    onApply(canvas.toDataURL('image/png'));
  };

  return (
    <motion.div onClick={onCancel}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      style={{
        position: 'fixed', inset: 0,
        backgroundColor: 'rgba(0,0,0,0.6)',
        zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}>
      <motion.div onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.94, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.94, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        style={{
          backgroundColor: '#fff',
          padding: 24,
          display: 'flex', flexDirection: 'column', gap: 16,
          maxWidth: 560, width: '100%',
          fontFamily: FONT,
        }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.muted, marginBottom: 4 }}>
            Crop Logo
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.ink }}>
            Pilih Area Persegi (1:1)
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
            Gambar tidak persegi. Tarik kotak putih untuk memilih bagian yang akan dijadikan logo.
          </div>
        </div>

        {imgInfo ? (
          <div ref={containerRef}
            style={{
              position: 'relative',
              width: displayW, height: displayH,
              margin: '0 auto',
              backgroundColor: '#000',
              userSelect: 'none',
              overflow: 'hidden',
            }}>
            <img src={src} alt="To crop" draggable={false}
              style={{ width: displayW, height: displayH, display: 'block', pointerEvents: 'none' }} />
            <div onMouseDown={handleMouseDown}
              style={{
                position: 'absolute',
                left: displayCropX, top: displayCropY,
                width: displayCropSize, height: displayCropSize,
                border: '2px solid #fff',
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
                cursor: 'move',
                boxSizing: 'border-box',
              }} />
          </div>
        ) : (
          <div style={{ minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 12 }}>
            Memuat gambar…
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <motion.button onClick={onCancel}
            whileTap={{ scale: 0.97 }}
            style={{
              flex: 1, height: 44,
              backgroundColor: '#fff', color: C.muted,
              border: `1px solid ${C.border}`,
              fontFamily: FONT, fontSize: 13, fontWeight: 800,
              cursor: 'pointer', outline: 'none',
            }}>
            Batal
          </motion.button>
          <motion.button onClick={handleApply} disabled={!imgInfo}
            whileTap={imgInfo ? { scale: 0.97 } : {}}
            style={{
              flex: 1.4, height: 44,
              backgroundColor: imgInfo ? C.ink : '#ddd',
              color: '#fff', border: 'none',
              fontFamily: FONT, fontSize: 13, fontWeight: 800,
              cursor: imgInfo ? 'pointer' : 'not-allowed', outline: 'none',
            }}>
            Simpan Crop
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Logo file picker — rectangle drop zone; enforces 1:1 via crop modal ─────
function LogoField({ field, onChange }) {
  const inputRef = useRef(null);
  const [cropSrc, setCropSrc] = useState(null);
  const enabled = field.enabled;

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const img = new Image();
      img.onload = () => {
        if (img.width === img.height) {
          onChange({ ...field, value: dataUrl });
        } else {
          setCropSrc(dataUrl); // open crop modal — user picks the 1:1 region
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <label style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: C.ink, textTransform: 'uppercase' }}>
          Logo Brand
        </label>
        <Toggle checked={enabled} onChange={(v) => onChange({ ...field, enabled: v })} />
      </div>

      <motion.button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={!enabled}
        whileTap={enabled ? { scale: 0.99 } : {}}
        whileHover={enabled ? { borderColor: C.ink } : {}}
        transition={{ duration: 0.15 }}
        style={{
          width: '100%',
          minHeight: 120,
          border: `1px dashed ${enabled ? '#bbb' : C.border}`,
          backgroundColor: enabled ? '#fff' : '#f6f6f6',
          padding: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          cursor: enabled ? 'pointer' : 'not-allowed',
          fontFamily: FONT,
          boxSizing: 'border-box',
          textAlign: 'left',
        }}
      >
        {field.value ? (
          <>
            <img src={field.value} alt="Logo preview"
              style={{
                width: 80, height: 80, objectFit: 'contain',
                backgroundColor: '#fff', border: `1px solid ${C.border}`,
                flexShrink: 0,
              }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: C.ink, letterSpacing: '0.02em' }}>
                Logo Terpasang
              </div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>
                Klik untuk ganti logo
              </div>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.ink, letterSpacing: '0.04em' }}>
              UPLOAD LOGO
            </div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
              Rasio 1:1 (Persegi). Jika tidak persegi, kamu bisa crop bagian yang dipakai.
            </div>
          </div>
        )}
      </motion.button>

      {field.value && enabled && (
        <motion.button type="button" onClick={() => onChange({ ...field, value: '' })}
          whileTap={{ scale: 0.97 }}
          style={{
            marginTop: 8,
            padding: '6px 12px', fontSize: 11, fontFamily: FONT, fontWeight: 700,
            backgroundColor: '#fff', color: C.muted,
            border: `1px solid ${C.border}`, cursor: 'pointer',
          }}>
          Hapus Logo
        </motion.button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleFile}
        disabled={!enabled}
        style={{ display: 'none' }}
      />

      <AnimatePresence>
        {cropSrc && (
          <CropModal
            src={cropSrc}
            onCancel={() => setCropSrc(null)}
            onApply={(dataUrl) => {
              onChange({ ...field, value: dataUrl });
              setCropSrc(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Item input — compact text input used inside ItemCard ────────────────────
function ItemInput({ label, value, onChange, placeholder }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <label style={{
        display: 'block', fontSize: 9, fontWeight: 800,
        letterSpacing: '0.08em', color: C.ink,
        textTransform: 'uppercase', marginBottom: 4,
      }}>
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%',
          padding: '8px 10px',
          fontSize: 13, fontFamily: FONT,
          border: `1px solid ${C.border}`,
          outline: 'none', backgroundColor: '#fff',
          boxSizing: 'border-box',
        }}
      />
    </div>
  );
}

// ── ItemCard — one shippable item with delete button (when >1 item) ─────────
function ItemCard({ item, index, total, onChange, onRemove }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18 }}
      style={{
        border: `1px solid ${C.border}`,
        padding: 12,
        marginBottom: 10,
        backgroundColor: '#fafafa',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: C.muted, textTransform: 'uppercase' }}>
          Barang {index + 1}
        </div>
        {total > 1 && (
          <motion.button type="button" onClick={onRemove}
            whileTap={{ scale: 0.95 }}
            whileHover={{ backgroundColor: C.red, color: '#fff', borderColor: C.red }}
            transition={{ duration: 0.15 }}
            style={{
              padding: '4px 10px', fontSize: 10, fontWeight: 700,
              backgroundColor: '#fff', color: C.red,
              border: `1px solid ${C.red}`, cursor: 'pointer', fontFamily: FONT,
              letterSpacing: '0.04em',
            }}>
            Hapus
          </motion.button>
        )}
      </div>
      <ItemInput label="Deskripsi" value={item.description}
        onChange={(v) => onChange({ ...item, description: v })}
        placeholder="Set peralatan keramik" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <ItemInput label="Berat" value={item.weight}
          onChange={(v) => onChange({ ...item, weight: v })}
          placeholder="1,20 kg" />
        <ItemInput label="Jumlah" value={item.qty}
          onChange={(v) => onChange({ ...item, qty: v })}
          placeholder="×4" />
        <ItemInput label="Harga" value={item.price}
          onChange={(v) => onChange({ ...item, price: v })}
          placeholder="Rp 96.000" />
      </div>
    </motion.div>
  );
}

// ── HandlingToggle — handling text is hardcoded; user only toggles visibility ─
function HandlingToggle({ label, field, onChange }) {
  return (
    <div style={{
      marginBottom: 6,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 0',
      borderBottom: `1px solid ${C.border}`,
    }}>
      <label style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: C.ink, textTransform: 'uppercase' }}>
        {label}
      </label>
      <Toggle checked={field.enabled} onChange={(v) => onChange({ ...field, enabled: v })} />
    </div>
  );
}

function SectionHeader({ children }) {
  return (
    <div style={{
      fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.muted,
      marginTop: 8, marginBottom: 10, paddingBottom: 4, borderBottom: `1px solid ${C.border}`,
    }}>
      {children}
    </div>
  );
}

// ── Date helper — Indonesian format ──────────────────────────────────────────
function formatDateID(d = new Date()) {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MEI', 'JUN', 'JUL', 'AGU', 'SEP', 'OKT', 'NOV', 'DES'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// ── Handling icons ───────────────────────────────────────────────────────────
function IconFragile({ color }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ width: '100%', height: '100%' }}>
      <path d="M8 3h8" />
      <path d="M9 3c0 4 1 6 3 6s3-2 3-6" />
      <path d="M12 9v9" />
      <path d="M9 21h6" />
      <path d="M8.5 6l1.5 1.5" />
    </svg>
  );
}
function IconArrowUp({ color }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '100%', height: '100%' }}>
      <path d="M12 20V4" />
      <path d="M5 11l7-7 7 7" />
    </svg>
  );
}
function IconNoStack({ color }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ width: '100%', height: '100%' }}>
      <rect x="3" y="13" width="18" height="6" />
      <rect x="3" y="5"  width="18" height="6" />
      <line x1="3" y1="3" x2="21" y2="21" strokeWidth="2" />
    </svg>
  );
}

// ── HandlingBox — bordered square with icon + label (used in A6 templates) ───
// Fixed width so the box stays the same size whether 1, 2 or 3 are shown.
const HANDLING_BOX_W = 148;
function HandlingBox({ text, accent, icon }) {
  const color = accent ? C.red : C.ink;
  const borderWidth = accent ? 2 : 1;
  return (
    <div style={{
      width: HANDLING_BOX_W,
      height: HANDLING_BOX_W,
      border: `${borderWidth}px solid ${color}`,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: 10, boxSizing: 'border-box',
      gap: 8,
      flexShrink: 0,
    }}>
      <div style={{ width: 30, height: 30 }}>{icon}</div>
      <div style={{
        fontSize: 10, fontWeight: 800,
        color, textAlign: 'center', letterSpacing: '0.04em',
        lineHeight: 1.15, whiteSpace: 'pre-line',
      }}>
        {text}
      </div>
    </div>
  );
}

// ── InlineWarning — used in Minimalis ────────────────────────────────────────
function InlineWarning({ icon, text, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <div style={{ width: 16, height: 16, flexShrink: 0 }}>{icon}</div>
      <div style={{ fontSize: 8.5, fontWeight: 800, color, letterSpacing: '0.04em', lineHeight: 1.15, whiteSpace: 'pre-line' }}>
        {text}
      </div>
    </div>
  );
}

function Hairline({ color = C.hairline }) {
  return <div style={{ height: 1, backgroundColor: color, flexShrink: 0 }} />;
}

// ── Common helpers for partial sections ──────────────────────────────────────
function anyEnabled(...fs) { return fs.some(f => f && f.enabled); }
function enabledHandlings(fields) {
  const list = [];
  if (fields.warningFragile.enabled)     list.push({ text: fields.warningFragile.value,     accent: true,  icon: <IconFragile color={C.red} /> });
  if (fields.warningOrientation.enabled) list.push({ text: fields.warningOrientation.value, accent: false, icon: <IconArrowUp color={C.ink} /> });
  if (fields.warningStack.enabled)       list.push({ text: fields.warningStack.value,       accent: false, icon: <IconNoStack color={C.ink} /> });
  return list;
}

// ── Label: A6 Standar ────────────────────────────────────────────────────────
function LabelA6Standar({ fields, date }) {
  const recipientShown = anyEnabled(fields.recipientName, fields.recipientAddress, fields.recipientPhone);
  const senderShown    = anyEnabled(fields.senderName, fields.senderAddress, fields.senderPhone);
  const items          = fields.items;
  const itemShown      = items.length > 0;
  const handlings      = enabledHandlings(fields);

  return (
    <div style={{
      width: 525, minHeight: 740,
      backgroundColor: '#fff',
      fontFamily: FONT, color: C.ink,
      padding: 26, boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 8, letterSpacing: '0.14em', color: C.muted }}>DIBUAT DENGAN</div>
          <div style={{ fontSize: 11, fontWeight: 800, marginTop: 2, letterSpacing: '0.02em' }}>RESIKU.ONLINE</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 8, letterSpacing: '0.14em', color: C.muted }}>TANGGAL</div>
          <div style={{ fontSize: 11, fontWeight: 700, marginTop: 2 }}>{date}</div>
        </div>
      </div>
      <Hairline />

      {/* PENERIMA */}
      {recipientShown && (
        <>
          <div>
            <div style={{ fontSize: 8, letterSpacing: '0.16em', color: C.muted, marginBottom: 6 }}>PENERIMA</div>
            {fields.recipientName.enabled && (
              <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1, marginBottom: 10 }}>
                {fields.recipientName.value}
              </div>
            )}
            {fields.recipientAddress.enabled && (
              <div style={{ fontSize: 13, lineHeight: 1.45, whiteSpace: 'pre-line' }}>
                {fields.recipientAddress.value}
              </div>
            )}
            {fields.recipientPhone.enabled && (
              <div style={{ fontSize: 12, marginTop: 8 }}>
                <span style={{ color: C.muted, marginRight: 6, letterSpacing: '0.08em' }}>TEL</span>
                <span style={{ fontWeight: 600 }}>{fields.recipientPhone.value}</span>
              </div>
            )}
          </div>
          <Hairline />
        </>
      )}

      {/* PENGIRIM */}
      {senderShown && (
        <>
          <div>
            <div style={{ fontSize: 8, letterSpacing: '0.16em', color: C.muted, marginBottom: 6 }}>PENGIRIM</div>
            {fields.senderName.enabled && (
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>
                {fields.senderName.value}
              </div>
            )}
            {fields.senderAddress.enabled && (
              <div style={{ fontSize: 12, lineHeight: 1.45, whiteSpace: 'pre-line' }}>
                {fields.senderAddress.value}
              </div>
            )}
            {fields.senderPhone.enabled && (
              <div style={{ fontSize: 11, marginTop: 6 }}>
                <span style={{ color: C.muted, marginRight: 6, letterSpacing: '0.08em' }}>TEL</span>
                <span style={{ fontWeight: 600 }}>{fields.senderPhone.value}</span>
              </div>
            )}
          </div>
          <Hairline />
        </>
      )}

      {/* Item rows */}
      {itemShown && (
        <>
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '2.2fr 1fr 1fr 1fr', gap: 14, marginBottom: 8 }}>
              {['BARANG', 'BERAT', 'JUMLAH', 'HARGA'].map((label) => (
                <div key={label} style={{ fontSize: 8, letterSpacing: '0.14em', color: C.muted }}>{label}</div>
              ))}
            </div>
            {items.map((item, i) => (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '2.2fr 1fr 1fr 1fr', gap: 14,
                paddingTop: i > 0 ? 6 : 0,
                marginTop: i > 0 ? 6 : 0,
                borderTop: i > 0 ? `1px dashed ${C.border}` : 'none',
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, wordBreak: 'break-word' }}>{item.description || '-'}</div>
                <div style={{ fontSize: 12, fontWeight: 700, wordBreak: 'break-word' }}>{item.weight || '-'}</div>
                <div style={{ fontSize: 12, fontWeight: 700, wordBreak: 'break-word' }}>{item.qty || '-'}</div>
                <div style={{ fontSize: 12, fontWeight: 700, wordBreak: 'break-word' }}>{item.price || '-'}</div>
              </div>
            ))}
          </div>
          <Hairline />
        </>
      )}

      {/* HANDLING */}
      {handlings.length > 0 && (
        <div>
          <div style={{ fontSize: 8, letterSpacing: '0.16em', color: C.muted, marginBottom: 10 }}>PENANGANAN</div>
          <div style={{ display: 'flex', gap: 14 }}>
            {handlings.map((h, i) => <HandlingBox key={i} {...h} />)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Label: A6 Standar + Logo Brand ───────────────────────────────────────────
function LabelA6Logo({ fields, date }) {
  const recipientShown = anyEnabled(fields.recipientName, fields.recipientAddress, fields.recipientPhone);
  const senderShown    = anyEnabled(fields.senderName, fields.senderAddress, fields.senderPhone);
  const items          = fields.items;
  const itemShown      = items.length > 0;
  const handlings      = enabledHandlings(fields);

  return (
    <div style={{
      width: 525, minHeight: 740,
      backgroundColor: '#fff',
      fontFamily: FONT, color: C.ink,
      padding: 26, boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      {/* Header: logo (uploaded or placeholder) + DIBUAT DENGAN + tanggal */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 18 }}>
        {fields.logo?.enabled && fields.logo.value ? (
          <img
            src={fields.logo.value}
            alt="Logo brand"
            crossOrigin="anonymous"
            style={{ width: 96, height: 96, objectFit: 'contain', objectPosition: 'left center', backgroundColor: '#fff', display: 'block' }}
          />
        ) : (
          <div style={{
            border: `1px solid ${C.border}`,
            width: 96, height: 96,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: C.faint }}>LOGO</div>
            <div style={{ fontSize: 8, color: C.faint, marginTop: 4 }}>1 : 1</div>
          </div>
        )}
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 8, letterSpacing: '0.14em', color: C.muted }}>DIBUAT DENGAN</div>
          <div style={{ fontSize: 11, fontWeight: 800, marginTop: 2 }}>RESIKU.ONLINE</div>
          <div style={{ fontSize: 11, marginTop: 10, color: C.faint }}>{date}</div>
        </div>
      </div>

      {/* PENERIMA */}
      {recipientShown && (
        <div>
          <div style={{ fontSize: 8, letterSpacing: '0.16em', color: C.muted, marginBottom: 6 }}>PENERIMA</div>
          {fields.recipientName.enabled && (
            <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.1, marginBottom: 10 }}>
              {fields.recipientName.value}
            </div>
          )}
          {fields.recipientAddress.enabled && (
            <div style={{ fontSize: 13, lineHeight: 1.45, whiteSpace: 'pre-line' }}>
              {fields.recipientAddress.value}
            </div>
          )}
          {fields.recipientPhone.enabled && (
            <div style={{ fontSize: 12, marginTop: 8 }}>
              <span style={{ color: C.muted, marginRight: 6, letterSpacing: '0.08em' }}>TEL</span>
              <span style={{ fontWeight: 600 }}>{fields.recipientPhone.value}</span>
            </div>
          )}
        </div>
      )}
      <Hairline />

      {/* DARI (sender) */}
      {senderShown && (
        <div>
          <div style={{ fontSize: 8, letterSpacing: '0.16em', color: C.muted, marginBottom: 6 }}>DARI</div>
          {fields.senderName.enabled && (
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>
              {fields.senderName.value}
            </div>
          )}
          <div style={{ fontSize: 11, lineHeight: 1.45, whiteSpace: 'pre-line' }}>
            {fields.senderAddress.enabled && <span>{fields.senderAddress.value}</span>}
            {fields.senderAddress.enabled && fields.senderPhone.enabled && <span> · </span>}
            {fields.senderPhone.enabled && (
              <>
                <span style={{ color: C.muted, letterSpacing: '0.08em' }}>TEL</span>
                <span style={{ marginLeft: 4 }}>{fields.senderPhone.value}</span>
              </>
            )}
          </div>
        </div>
      )}
      <Hairline />

      {/* Item rows */}
      {itemShown && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '2.2fr 1fr 1fr 1fr', gap: 14, marginBottom: 8 }}>
            {['BARANG', 'BERAT', 'JUMLAH', 'HARGA'].map((label) => (
              <div key={label} style={{ fontSize: 8, letterSpacing: '0.14em', color: C.muted }}>{label}</div>
            ))}
          </div>
          {items.map((item, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '2.2fr 1fr 1fr 1fr', gap: 14,
              paddingTop: i > 0 ? 6 : 0,
              marginTop: i > 0 ? 6 : 0,
              borderTop: i > 0 ? `1px dashed ${C.border}` : 'none',
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, wordBreak: 'break-word' }}>{item.description || '-'}</div>
              <div style={{ fontSize: 12, fontWeight: 700, wordBreak: 'break-word' }}>{item.weight || '-'}</div>
              <div style={{ fontSize: 12, fontWeight: 700, wordBreak: 'break-word' }}>{item.qty || '-'}</div>
              <div style={{ fontSize: 12, fontWeight: 700, wordBreak: 'break-word' }}>{item.price || '-'}</div>
            </div>
          ))}
        </div>
      )}

      {/* HANDLING */}
      {handlings.length > 0 && (
        <div>
          <div style={{ fontSize: 8, letterSpacing: '0.16em', color: C.muted, marginBottom: 10 }}>PENANGANAN</div>
          <div style={{ display: 'flex', gap: 14 }}>
            {handlings.map((h, i) => <HandlingBox key={i} {...h} />)}
          </div>
        </div>
      )}

      {/* Footer: PAKET 1/1 */}
      <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, fontSize: 9, paddingTop: 8, borderTop: `1px solid ${C.hairline}` }}>
        <div style={{ letterSpacing: '0.12em', color: C.muted, fontWeight: 800, whiteSpace: 'nowrap' }}>PAKET 1/1</div>
      </div>
    </div>
  );
}

// ── Label: Minimalis (square) ────────────────────────────────────────────────
function LabelMinimalis({ fields, date }) {
  const handlings = enabledHandlings(fields);
  const items = fields.items;

  return (
    <div style={{
      width: 525, minHeight: 525,
      backgroundColor: '#fff',
      fontFamily: FONT, color: C.ink,
      padding: 28, boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9 }}>
        <div style={{ fontWeight: 800, letterSpacing: '0.04em' }}>RESIKU.ONLINE</div>
        <div style={{ color: C.faint }}>{date}</div>
      </div>

      {/* Two-column PENERIMA / PENGIRIM */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28, marginTop: 18 }}>
        {anyEnabled(fields.recipientName, fields.recipientAddress, fields.recipientPhone) && (
          <div>
            <div style={{ fontSize: 8, letterSpacing: '0.16em', color: C.muted, marginBottom: 8 }}>PENERIMA</div>
            {fields.recipientName.enabled && (
              <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.1, marginBottom: 8 }}>
                {fields.recipientName.value}
              </div>
            )}
            {fields.recipientAddress.enabled && (
              <div style={{ fontSize: 11, lineHeight: 1.45, whiteSpace: 'pre-line', marginBottom: 8 }}>
                {fields.recipientAddress.value}
              </div>
            )}
            {fields.recipientPhone.enabled && (
              <div style={{ fontSize: 10.5, color: C.faint }}>{fields.recipientPhone.value}</div>
            )}
          </div>
        )}
        {anyEnabled(fields.senderName, fields.senderAddress, fields.senderPhone) && (
          <div>
            <div style={{ fontSize: 8, letterSpacing: '0.16em', color: C.muted, marginBottom: 8 }}>PENGIRIM</div>
            {fields.senderName.enabled && (
              <div style={{ fontSize: 12.5, fontWeight: 800, lineHeight: 1.2, marginBottom: 8, whiteSpace: 'pre-line' }}>
                {fields.senderName.value}
              </div>
            )}
            {fields.senderAddress.enabled && (
              <div style={{ fontSize: 11, lineHeight: 1.45, whiteSpace: 'pre-line', marginBottom: 8 }}>
                {fields.senderAddress.value}
              </div>
            )}
            {fields.senderPhone.enabled && (
              <div style={{ fontSize: 10.5, color: C.faint }}>{fields.senderPhone.value}</div>
            )}
          </div>
        )}
      </div>

      {/* Item rows */}
      {items.length > 0 && (
        <div style={{ marginTop: 'auto' }}>
          <div style={{
            borderTop:    `1px dashed ${C.hairline}`,
            borderBottom: `1px dashed ${C.hairline}`,
            padding: '10px 0',
          }}>
            {items.map((item, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                marginTop: i > 0 ? 6 : 0,
              }}>
                <div style={{ fontSize: 8, letterSpacing: '0.16em', color: C.muted, fontWeight: 800, width: 48, flexShrink: 0 }}>
                  {i === 0 ? 'BARANG' : ''}
                </div>
                <div style={{ flex: 1, fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.description || '-'}
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 11, color: C.faint }}>
                  {item.weight && <span style={{ fontWeight: 700, color: C.ink }}>{item.weight}</span>}
                  {item.qty && <span>{item.qty}</span>}
                  {item.price && <span style={{ fontWeight: 700, color: C.ink }}>{item.price}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Handling row */}
      {handlings.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `auto repeat(${handlings.length}, 1fr)`, gap: 16, alignItems: 'center', paddingTop: 14 }}>
          <div style={{ fontSize: 8, letterSpacing: '0.16em', color: C.muted, fontWeight: 800 }}>PENANGANAN</div>
          {handlings.map((h, i) => (
            <InlineWarning key={i} icon={h.icon} text={h.text} color={h.accent ? C.red : C.ink} />
          ))}
        </div>
      )}
    </div>
  );
}

const LABEL_COMPONENTS = {
  'a6-standar': LabelA6Standar,
  'a6-logo':    LabelA6Logo,
  'minimalis':  LabelMinimalis,
};

// ── PreviewFrame — scales the native-size Label to fit container ─────────────
function PreviewFrame({ template, fields, date, exportRef }) {
  const wrapRef = useRef(null);
  const labelRef = useRef(null);
  const [scale, setScale] = useState(0);
  const [naturalH, setNaturalH] = useState(0);
  const { w: BW, h: BH } = BASE_DIMS[template];

  // Scale by container width — content can grow vertically, wrapper scrolls.
  useLayoutEffect(() => {
    if (!wrapRef.current) return;
    const update = () => {
      const r = wrapRef.current.getBoundingClientRect();
      if (r.width === 0) return;
      setScale(r.width / BW);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [template, BW]);

  // Measure label's natural (unscaled) height so the visible scroll area
  // matches the actual rendered content rather than a hardcoded BH.
  useLayoutEffect(() => {
    if (!labelRef.current) return;
    const update = () => setNaturalH(labelRef.current.scrollHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(labelRef.current);
    return () => ro.disconnect();
  });

  const Label = LABEL_COMPONENTS[template];
  const effectiveH = Math.max(BH, naturalH);
  const scaledH = effectiveH * scale;

  return (
    <>
      <div ref={wrapRef} style={{
        width: '100%', height: '100%',
        overflowY: 'auto', overflowX: 'hidden',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
      }}>
        {scale > 0 && (
          <div style={{
            width: BW * scale, height: scaledH,
            position: 'relative',
            boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
            flexShrink: 0,
          }}>
            <div ref={labelRef} style={{
              width: BW,
              position: 'absolute', top: 0, left: 0,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}>
              <Label fields={fields} date={date} />
            </div>
          </div>
        )}
      </div>

      {/* Off-screen native-size clone for PDF capture — html2canvas reads
          this directly via exportRef so it gets full-resolution output
          regardless of how the visible preview is scaled. */}
      <div style={{
        position: 'fixed',
        top: -100000, left: -100000,
        pointerEvents: 'none',
        zIndex: -1,
      }}>
        <div ref={exportRef} style={{ width: BW, minHeight: BH, backgroundColor: '#fff' }}>
          <Label fields={fields} date={date} />
        </div>
      </div>
    </>
  );
}

// ── Screen 1: Menu Utama ─────────────────────────────────────────────────────
function MainMenu({ onStart }) {
  return (
    <motion.div
      key="main"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      style={{ height: '100%', overflowY: 'auto', backgroundColor: '#fff' }}
    >
      <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -32 }}
          transition={SPRING}
          style={{
            width: MAIN_MENU_W,
            display: 'flex',
            alignItems: 'center',
            gap: 80,
            paddingLeft: 70,
            boxSizing: 'border-box',
          }}
        >
          {/* Left — brand + copy + CTA */}
          <div style={{ width: 280, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
              <ResikuMark size={40} />
              <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: '0.02em', color: C.ink }}>RESIKU.ONLINE</span>
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: C.ink, margin: 0, marginBottom: 16, letterSpacing: '-0.01em', lineHeight: '34px' }}>
              Bikin Label Pengiriman Mudah
            </h1>
            <p style={{ fontSize: 13, lineHeight: '19px', color: C.muted, margin: 0, marginBottom: 28 }}>
              Bikin label pengiriman sekarang lebih gampang. Cocok buat toko online, kebutuhan pribadi, atau pengiriman dalam jumlah banyak. Tinggal isi detail, pilih layout, lalu unduh label siap cetak dalam hitungan detik.
            </p>
            <motion.button onClick={onStart}
              whileTap={{ scale: 0.98 }}
              whileHover={{ y: -1 }}
              transition={{ duration: 0.15 }}
              style={{ width: '100%', height: 48, backgroundColor: C.ink, color: '#fff', border: 'none', borderRadius: 0, fontFamily: FONT, fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
              Mulai Sekarang
            </motion.button>
          </div>

          {/* Right — 3 template thumbs in a row */}
          <div style={{ flex: 1, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            {TEMPLATES.map(t => (
              <motion.div
                key={t.id}
                layoutId={`tpl-${t.id}`}
                transition={SPRING}
                style={{ flex: 1, backgroundColor: '#fff', border: `1px solid ${C.border}` }}
              >
                <TemplateThumb variant={t.id} />
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

// ── Screen 2: Pilih Template ─────────────────────────────────────────────────
function SelectTemplate({ template, onSelect, onNext, onBack }) {
  const [previewId, setPreviewId] = useState(null);
  return (
    <motion.div
      key="select"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      style={{ height: '100%', overflowY: 'auto', backgroundColor: '#fff' }}
    >
      <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', gap: 32 }}>
        {/* Top — 3 large template thumbs in a row */}
        <div style={{ width: SELECT_TPL_W, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          {TEMPLATES.map(t => {
            const selected = t.id === template;
            return (
              <motion.button
                key={t.id}
                layoutId={`tpl-${t.id}`}
                transition={SPRING}
                onClick={() => setPreviewId(t.id)}
                style={{
                  flex: 1, position: 'relative', padding: 12, backgroundColor: '#fff',
                  border: selected ? `2px solid ${C.ink}` : `1px solid ${C.border}`,
                  borderRadius: 0, cursor: 'zoom-in', fontFamily: FONT, outline: 'none',
                }}
              >
                <TemplateThumb variant={t.id} />
                {/* Magnify badge — signals the thumb is clickable for preview */}
                <div style={{
                  position: 'absolute', top: 12, right: 12,
                  width: 26, height: 26,
                  backgroundColor: 'rgba(17,17,17,0.82)',
                  borderRadius: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  pointerEvents: 'none',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-4.35-4.35" />
                    <path d="M11 8v6M8 11h6" />
                  </svg>
                </div>
                {selected && (
                  <div style={{ position: 'absolute', right: 0, bottom: 0, width: 28, height: 28, backgroundColor: C.ink, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>✓</div>
                )}
              </motion.button>
            );
          })}
        </div>

        {/* Bottom — Pilih Template card with copy + selectors + Selanjutnya */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ ...SPRING, delay: 0.08 }}
          style={{
            width: SELECT_TPL_W,
          }}
        >
          <h2 style={{ fontSize: 26, fontWeight: 800, color: C.ink, margin: 0, marginBottom: 12, letterSpacing: '-0.01em' }}>Pilih Template</h2>
          <p style={{ fontSize: 13, lineHeight: '19px', color: C.muted, margin: 0, marginBottom: 26, maxWidth: 640 }}>
            Pilih jenis label pengiriman yang paling sesuai dengan kebutuhan pengiriman kamu untuk membantu paket terlihat lebih profesional dan lebih mudah ditangani saat proses pengiriman.
          </p>
          <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
            {TEMPLATES.map(t => {
              const selected = t.id === template;
              return (
                <motion.button key={t.id} onClick={() => onSelect(t.id)}
                  whileTap={{ scale: 0.98 }}
                  animate={{
                    backgroundColor: selected ? C.ink : '#fff',
                    color: selected ? '#fff' : C.disabled,
                  }}
                  transition={{ duration: 0.18 }}
                  style={{
                    flex: 1, height: 50,
                    border: `1px solid ${selected ? C.ink : C.border}`,
                    borderRadius: 0, fontFamily: FONT, fontSize: 14, fontWeight: 800, cursor: 'pointer', outline: 'none',
                  }}>
                  {t.label}
                </motion.button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <motion.button onClick={onBack}
              whileTap={{ scale: 0.98 }}
              style={{
                width: 180, height: 56,
                backgroundColor: '#fff',
                color: C.ink,
                border: `1px solid ${C.border}`,
                borderRadius: 0, fontFamily: FONT, fontSize: 14, fontWeight: 800,
                cursor: 'pointer', outline: 'none',
              }}>
              Kembali
            </motion.button>
            <motion.button disabled={!template} onClick={onNext}
              whileTap={template ? { scale: 0.98 } : {}}
              whileHover={template ? { y: -1 } : {}}
              animate={{
                backgroundColor: template ? C.ink : '#d0d0d0',
                color: template ? '#fff' : '#bfbfbf',
              }}
              transition={{ duration: 0.18 }}
              style={{
                flex: 1, height: 56,
                border: 'none', borderRadius: 0, fontFamily: FONT, fontSize: 14, fontWeight: 800,
                cursor: template ? 'pointer' : 'not-allowed', outline: 'none',
              }}>
              Selanjutnya
            </motion.button>
          </div>
        </motion.div>
      </div>

      {/* Modal pratinjau — dibuka dengan klik thumb */}
      <AnimatePresence>
        {previewId && (
          <motion.div
            key="preview-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setPreviewId(null)}
            style={{
              position: 'fixed', inset: 0,
              backgroundColor: 'rgba(0,0,0,0.55)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 100, padding: 24,
            }}
          >
            <motion.div
              key="preview-card"
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={SPRING}
              onClick={(e) => e.stopPropagation()}
              style={{
                backgroundColor: '#fff', borderRadius: 0, padding: 24,
                width: '100%', maxWidth: 540, maxHeight: '92vh',
                display: 'flex', flexDirection: 'column', gap: 16,
                boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.muted, marginBottom: 4 }}>
                    Pratinjau
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: C.ink }}>
                    {T[previewId].label}
                  </div>
                </div>
                <motion.button onClick={() => setPreviewId(null)}
                  whileTap={{ scale: 0.9 }}
                  whileHover={{ backgroundColor: '#e6e6e6' }}
                  style={{
                    width: 28, height: 28, borderRadius: 0, border: 'none',
                    backgroundColor: '#f1f1f1', color: C.ink, fontSize: 13,
                    cursor: 'pointer', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', padding: 0,
                  }}>✕</motion.button>
              </div>
              <div style={{
                flex: 1, minHeight: 0,
                backgroundColor: '#fafafa',
                border: `1px solid ${C.border}`, borderRadius: 0,
                padding: 16, display: 'flex',
                justifyContent: 'center', alignItems: 'center', overflow: 'auto',
              }}>
                <img
                  src={T[previewId].src}
                  alt={T[previewId].label}
                  draggable={false}
                  style={{
                    maxWidth: '100%', maxHeight: '70vh',
                    aspectRatio: T[previewId].aspect,
                    objectFit: 'contain', display: 'block', userSelect: 'none',
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <motion.button onClick={() => setPreviewId(null)}
                  whileTap={{ scale: 0.97 }}
                  style={{
                    flex: 1, height: 44, backgroundColor: '#fff', color: C.muted,
                    border: `1px solid ${C.border}`, borderRadius: 0,
                    fontFamily: FONT, fontSize: 13, fontWeight: 800,
                    cursor: 'pointer', outline: 'none',
                  }}>
                  Tutup
                </motion.button>
                <motion.button
                  disabled={previewId === template}
                  onClick={() => { onSelect(previewId); setPreviewId(null); }}
                  whileTap={previewId !== template ? { scale: 0.97 } : {}}
                  whileHover={previewId !== template ? { y: -1 } : {}}
                  transition={{ duration: 0.15 }}
                  style={{
                    flex: 1.4, height: 44,
                    backgroundColor: previewId === template ? '#d8d8d8' : C.ink,
                    color: previewId === template ? '#fafafa' : '#fff',
                    border: 'none', borderRadius: 0,
                    fontFamily: FONT, fontSize: 13, fontWeight: 800,
                    cursor: previewId === template ? 'not-allowed' : 'pointer',
                    outline: 'none',
                  }}>
                  {previewId === template ? 'Sudah Dipilih' : 'Pilih Template ini'}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Screen 3: Formulir + Pratinjau (preview dinamis) ─────────────────────────
function FormPreview({ template, onBack }) {
  const [fields, setFields] = useState({
    senderName:        { enabled: true,  value: 'Toko Maru Coffee' },
    senderAddress:     { enabled: true,  value: 'Jl. Cihampelas No. 160\nBandung 40131, Jawa Barat' },
    senderPhone:       { enabled: true,  value: '+62 822 1234 5678' },
    recipientName:     { enabled: true,  value: 'Hiroko Tanaka' },
    recipientAddress:  { enabled: true,  value: 'Jl. Sudirman No. 24, Apt 14B\nJakarta Pusat 10220\nINDONESIA' },
    recipientPhone:    { enabled: true,  value: '+62 815 9876 5432' },
    items: [
      { description: 'Set peralatan makan keramik', weight: '3,40 kg', qty: '×1', price: 'Rp 250.000' },
    ],
    serviceType:       { enabled: false, value: 'Reguler' },
    warningFragile:    { enabled: true,  value: 'BARANG\nPECAH BELAH' },
    warningOrientation:{ enabled: true,  value: 'BAGIAN\nMENGHADAP ATAS' },
    warningStack:      { enabled: true,  value: 'JANGAN\nDITUMPUK' },
    logo:              { enabled: true,  value: '' }, // data URL of uploaded brand logo
  });
  const set = (key) => (v) => setFields(prev => ({ ...prev, [key]: v }));

  const updateItem = (i, item) => setFields(prev => ({
    ...prev,
    items: prev.items.map((it, idx) => (idx === i ? item : it)),
  }));
  const addItem = () => setFields(prev => ({
    ...prev,
    items: [...prev.items, { description: '', weight: '', qty: '', price: '' }],
  }));
  const removeItem = (i) => setFields(prev => ({
    ...prev,
    items: prev.items.filter((_, idx) => idx !== i),
  }));

  const exportRef = useRef(null);
  const [downloading, setDownloading] = useState(false);
  const date = formatDateID();

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const el = exportRef.current;
      if (!el) throw new Error('Elemen pratinjau belum siap');

      const canvas = await html2canvas(el, {
        scale: 3,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        windowHeight: el.scrollHeight, // capture full natural height (incl. overflow)
        height: el.scrollHeight,
      });
      const imgData = canvas.toDataURL('image/jpeg', 0.95);

      // Page width stays at template's A6 width (105mm); height grows
      // proportionally with the captured canvas so nothing gets clipped.
      const pageW = T[template].pageMm[0];
      const pageH = pageW * (canvas.height / canvas.width);
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [pageW, pageH] });
      pdf.addImage(imgData, 'JPEG', 0, 0, pageW, pageH);

      const recipient = (fields.recipientName.enabled && fields.recipientName.value) || 'label';
      const safe = recipient.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
      pdf.save(`label-pengiriman-${safe}.pdf`);
    } catch (err) {
      console.error('PDF export gagal', err);
      alert('Gagal membuat PDF. Cek console.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      gap: 20,
      padding: '24px 28px',
      boxSizing: 'border-box',
      overflow: 'hidden',
      minHeight: 0,
    }}>
      {/* KIRI — FORMULIR */}
      <div style={{
        flex: 1,
        backgroundColor: '#fff',
        border: `1px solid ${C.border}`,
        borderRadius: 0,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexShrink: 0 }}>
          <ResikuMark size={28} />
          <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.08em', color: C.ink }}>FORMULIR</span>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, paddingRight: 10, minHeight: 0 }}>
          {template === 'a6-logo' && (
            <>
              <SectionHeader>Logo Brand</SectionHeader>
              <LogoField field={fields.logo} onChange={set('logo')} />
            </>
          )}

          <SectionHeader>Pengirim</SectionHeader>
          <FormField label="Nama Pengirim"     field={fields.senderName}    onChange={set('senderName')} />
          <FormField label="Alamat Pengirim"   field={fields.senderAddress} onChange={set('senderAddress')} type="textarea" />
          <FormField label="No. HP Pengirim"   field={fields.senderPhone}   onChange={set('senderPhone')} />

          <SectionHeader>Penerima</SectionHeader>
          <FormField label="Nama Penerima"    field={fields.recipientName}    onChange={set('recipientName')} />
          <FormField label="Alamat Penerima"  field={fields.recipientAddress} onChange={set('recipientAddress')} type="textarea" />
          <FormField label="No. HP Penerima"  field={fields.recipientPhone}   onChange={set('recipientPhone')} />

          <SectionHeader>Barang</SectionHeader>
          <AnimatePresence initial={false}>
            {fields.items.map((item, i) => (
              <ItemCard
                key={i}
                item={item}
                index={i}
                total={fields.items.length}
                onChange={(updated) => updateItem(i, updated)}
                onRemove={() => removeItem(i)}
              />
            ))}
          </AnimatePresence>
          <motion.button type="button" onClick={addItem}
            whileTap={{ scale: 0.99 }}
            whileHover={{ backgroundColor: '#fafafa' }}
            transition={{ duration: 0.15 }}
            style={{
              width: '100%', padding: '10px 12px',
              backgroundColor: '#fff', color: C.ink,
              border: `1px dashed ${C.ink}`,
              fontFamily: FONT, fontSize: 11, fontWeight: 800,
              letterSpacing: '0.06em', cursor: 'pointer',
              marginBottom: 14,
            }}>
            + TAMBAH BARANG
          </motion.button>

          <SectionHeader>Layanan</SectionHeader>
          <FormField label="Jenis Layanan" field={fields.serviceType} onChange={set('serviceType')} type="select" options={['Reguler', 'Ekspres', 'Sehari', 'Ekonomi']} />

          <SectionHeader>Penanganan</SectionHeader>
          <HandlingToggle label="Peringatan Pecah Belah" field={fields.warningFragile}     onChange={set('warningFragile')} />
          <HandlingToggle label="Peringatan Orientasi"   field={fields.warningOrientation} onChange={set('warningOrientation')} />
          <HandlingToggle label="Peringatan Tumpukan"    field={fields.warningStack}       onChange={set('warningStack')} />
        </div>
      </div>

      {/* KANAN — Pratinjau dinamis */}
      <div style={{
        width: 420,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        flexShrink: 0,
        minHeight: 0,
      }}>
        <div style={{
          flex: 1,
          backgroundColor: '#fff',
          border: `1px solid ${C.border}`,
          borderRadius: 0,
          padding: 18,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          overflow: 'hidden',
          minHeight: 0,
        }}>
          <PreviewFrame template={template} fields={fields} date={date} exportRef={exportRef} />
        </div>

        <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
          <motion.button onClick={onBack}
            whileTap={{ scale: 0.98 }}
            style={{ flex: 1, height: 48, backgroundColor: '#fff', color: C.muted, border: `1px solid ${C.border}`, borderRadius: 0, fontFamily: FONT, fontSize: 13, fontWeight: 800, cursor: 'pointer', outline: 'none' }}>
            Kembali
          </motion.button>
          <motion.button onClick={handleDownload} disabled={downloading}
            whileTap={downloading ? {} : { scale: 0.98 }}
            whileHover={downloading ? {} : { y: -1 }}
            transition={{ duration: 0.15 }}
            style={{ flex: 1.4, height: 48, backgroundColor: C.ink, color: '#fff', border: 'none', borderRadius: 0, fontFamily: FONT, fontSize: 13, fontWeight: 800, cursor: downloading ? 'wait' : 'pointer', outline: 'none', opacity: downloading ? 0.7 : 1 }}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={downloading ? 'loading' : 'idle'}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
              >
                {downloading ? 'Mengunduh…' : 'Unduh'}
              </motion.span>
            </AnimatePresence>
          </motion.button>
        </div>
      </div>
    </div>
  );
}

// ── App shell ────────────────────────────────────────────────────────────────
export default function Apps2() {
  const [screen, setScreen]     = useState('main');
  const [template, setTemplate] = useState(null);

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      backgroundColor: C.canvas,
      fontFamily: FONT,
      WebkitFontSmoothing: 'antialiased',
      MozOsxFontSmoothing: 'grayscale',
      overflow: 'hidden',
      position: 'relative',
    }}>
      <AnimatePresence mode="popLayout" initial={false}>
        {screen === 'main'   && <MainMenu onStart={() => setScreen('select')} />}
        {screen === 'select' && <SelectTemplate template={template} onSelect={setTemplate} onNext={() => setScreen('form')} onBack={() => setScreen('main')} />}
        {screen === 'form'   && <FormPreview template={template} onBack={() => setScreen('select')} />}
      </AnimatePresence>
    </div>
  );
}
