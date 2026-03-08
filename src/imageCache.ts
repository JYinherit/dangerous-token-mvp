/**
 * imageCache.ts
 * 使用 localStorage 缓存卡牌图片（以 Base64 dataURL 存储）。
 * 缓存条目记录：文件名、数据URL、原始文件大小（字节）、最后使用时间戳。
 */

const CACHE_KEY = 'dangerous-token-image-cache';

export interface ImageCacheEntry {
    /** 原始文件名，作为唯一标识 */
    name: string;
    /** Base64 dataURL，可直接用于 <img src> */
    dataUrl: string;
    /** 原始文件大小（字节） */
    size: number;
    /** 最后使用时间戳（ms） */
    lastUsed: number;
}

/** 读取整个缓存（返回名称->条目的 Map） */
export function getCache(): Map<string, ImageCacheEntry> {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return new Map();
        const obj: Record<string, ImageCacheEntry> = JSON.parse(raw);
        return new Map(Object.entries(obj));
    } catch {
        return new Map();
    }
}

/** 将图片保存到缓存 */
export function saveToCache(name: string, dataUrl: string, size: number): ImageCacheEntry {
    const cache = getCache();
    const entry: ImageCacheEntry = { name, dataUrl, size, lastUsed: Date.now() };
    cache.set(name, entry);
    persistCache(cache);
    return entry;
}

/** 更新某条缓存的 lastUsed 时间 */
export function touchCache(name: string): void {
    const cache = getCache();
    const entry = cache.get(name);
    if (entry) {
        entry.lastUsed = Date.now();
        persistCache(cache);
    }
}

/** 删除单条缓存 */
export function removeFromCache(name: string): void {
    const cache = getCache();
    cache.delete(name);
    persistCache(cache);
}

/** 清空所有缓存 */
export function clearCache(): void {
    localStorage.removeItem(CACHE_KEY);
}

/** 内部：将 Map 序列化写回 localStorage */
function persistCache(cache: Map<string, ImageCacheEntry>): void {
    const obj: Record<string, ImageCacheEntry> = {};
    cache.forEach((v, k) => { obj[k] = v; });
    localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
}

/** 格式化文件大小显示 */
export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
