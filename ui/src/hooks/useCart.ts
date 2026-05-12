import { useCallback, useEffect, useMemo, useState } from "react";

export interface CartItem {
  productId: string;
  productName: string;
  productNameAr?: string;
  unitPriceCents: number;
  quantity: number;
  imageUrl?: string;
  currency?: string;
}

interface StoredCart {
  items: CartItem[];
}

const STORAGE_PREFIX = "paperclip:cart:";

function storageKey(slug: string): string {
  return `${STORAGE_PREFIX}${slug}`;
}

function readStorage(slug: string): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredCart;
    if (!parsed || !Array.isArray(parsed.items)) return [];
    return parsed.items.filter(
      (i): i is CartItem =>
        Boolean(i) &&
        typeof i.productId === "string" &&
        typeof i.productName === "string" &&
        typeof i.unitPriceCents === "number" &&
        typeof i.quantity === "number",
    );
  } catch {
    return [];
  }
}

function writeStorage(slug: string, items: CartItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(slug), JSON.stringify({ items }));
    window.dispatchEvent(
      new CustomEvent("paperclip-cart-changed", { detail: { slug } }),
    );
  } catch {
    // Swallow QuotaExceeded etc. — cart is best-effort persistent state.
  }
}

export interface UseCartResult {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, qty: number) => void;
  clear: () => void;
  totalCents: number;
  itemCount: number;
}

export function useCart(storefrontSlug: string): UseCartResult {
  const slug = storefrontSlug.toLowerCase();
  const [items, setItems] = useState<CartItem[]>(() => readStorage(slug));

  // Reload when storefront slug changes
  useEffect(() => {
    setItems(readStorage(slug));
  }, [slug]);

  // Cross-tab + cross-page sync
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (!e.key) return;
      if (e.key !== storageKey(slug)) return;
      setItems(readStorage(slug));
    }
    function onCustom(e: Event) {
      const detail = (e as CustomEvent<{ slug?: string }>).detail;
      if (!detail || detail.slug === slug) {
        setItems(readStorage(slug));
      }
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener("paperclip-cart-changed", onCustom as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(
        "paperclip-cart-changed",
        onCustom as EventListener,
      );
    };
  }, [slug]);

  const persist = useCallback(
    (next: CartItem[]) => {
      setItems(next);
      writeStorage(slug, next);
    },
    [slug],
  );

  const addItem = useCallback(
    (item: CartItem) => {
      const sanitized: CartItem = {
        ...item,
        quantity: Math.max(1, Math.min(Math.round(item.quantity || 1), 999)),
      };
      setItems((current) => {
        const idx = current.findIndex((i) => i.productId === sanitized.productId);
        let next: CartItem[];
        if (idx >= 0) {
          next = current.slice();
          const prev = next[idx]!;
          next[idx] = {
            ...prev,
            quantity: Math.min(prev.quantity + sanitized.quantity, 999),
          };
        } else {
          next = [...current, sanitized];
        }
        writeStorage(slug, next);
        return next;
      });
    },
    [slug],
  );

  const removeItem = useCallback(
    (productId: string) => {
      setItems((current) => {
        const next = current.filter((i) => i.productId !== productId);
        writeStorage(slug, next);
        return next;
      });
    },
    [slug],
  );

  const updateQuantity = useCallback(
    (productId: string, qty: number) => {
      const target = Math.max(0, Math.min(Math.round(qty || 0), 999));
      setItems((current) => {
        let next: CartItem[];
        if (target <= 0) {
          next = current.filter((i) => i.productId !== productId);
        } else {
          next = current.map((i) =>
            i.productId === productId ? { ...i, quantity: target } : i,
          );
        }
        writeStorage(slug, next);
        return next;
      });
    },
    [slug],
  );

  const clear = useCallback(() => {
    persist([]);
  }, [persist]);

  const totalCents = useMemo(
    () => items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0),
    [items],
  );
  const itemCount = useMemo(
    () => items.reduce((sum, i) => sum + i.quantity, 0),
    [items],
  );

  return { items, addItem, removeItem, updateQuantity, clear, totalCents, itemCount };
}
