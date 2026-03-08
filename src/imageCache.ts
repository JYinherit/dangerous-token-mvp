/**
 * imageCache.ts — Blob 版（无 Base64 开销）
 *
 * 存储策略：
 *  - IndexedDB 存储原始 Blob（零编码开销，支持几百 MB）
 *  - 上传时 Canvas 生成 ~160px JPEG 缩略图（几 KB）缓存供面板展示
 *  - 取图时 URL.createObjectURL(blob) → 极短字符串引用，instant
 */

const DB_NAME = 'dangerous-token-images-v2';
const DB_VERSION = 1;
const STORE_NAME = 'images';
const THUMBNAIL_MAX = 160; // px

// ── 导出类型 ─────────────────────────────────────────────────────

/** React state 中存储的轻量 meta（不含 Blob / Base64，内存极小） */
export interface ImageCacheMeta {
    name: string;
    thumbnail: string; // 小 JPEG Base64，仅用于缩略图面板
    size: number;
    lastUsed: number;
}

/** IndexedDB 内部存储结构 */
interface ImageCacheDBEntry extends ImageCacheMeta {
    blob: Blob;
}

// ── 内部：打开 DB ─────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (ev) => {
            const db = (ev.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'name' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// ── 缩略图生成（Canvas，不产生大字符串）────────────────────────────

export async function generateThumbnail(blob: Blob): Promise<string> {
    return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(blob);
        img.onload = () => {
            const ratio = Math.min(THUMBNAIL_MAX / img.width, THUMBNAIL_MAX / img.height, 1);
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * ratio);
            canvas.height = Math.round(img.height * ratio);
            canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/jpeg', 0.75));
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(''); };
        img.src = url;
    });
}

// ── 公共 API ──────────────────────────────────────────────────────

/** 读取全部缓存的轻量 Meta（不含 Blob），适合 React state */
export async function getCache(): Promise<Map<string, ImageCacheMeta>> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => {
            const all = req.result as ImageCacheDBEntry[];
            resolve(new Map(all.map(e => [e.name, { name: e.name, thumbnail: e.thumbnail, size: e.size, lastUsed: e.lastUsed }])));
        };
        req.onerror = () => reject(req.error);
    });
}

/**
 * 获取指定图片的 Object URL（即时，无编码开销）。
 * 调用方负责在不需要时 URL.revokeObjectURL()。
 */
export async function getImageObjectUrl(name: string): Promise<string | null> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(name);
        req.onsuccess = () => {
            const entry = req.result as ImageCacheDBEntry | undefined;
            if (!entry) { resolve(null); return; }
            store.put({ ...entry, lastUsed: Date.now() }); // 更新 lastUsed
            resolve(URL.createObjectURL(entry.blob));
        };
        req.onerror = () => reject(req.error);
    });
}

/**
 * 批量保存图片（一个 IDB 事务，无竞态）。
 * 调用方传入 File/Blob 即可，不需要提前转 Base64。
 */
export async function batchSaveToCache(
    entries: Array<{ name: string; blob: Blob; thumbnail: string; size: number }>
): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const now = Date.now();
        entries.forEach(({ name, blob, thumbnail, size }, i) => {
            store.put({ name, blob, thumbnail, size, lastUsed: now + i } satisfies ImageCacheDBEntry);
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/** 删除单条缓存 */
export async function removeFromCache(name: string): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(name);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/** 清空所有缓存 */
export async function clearCache(): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/** 格式化文件大小 */
export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
