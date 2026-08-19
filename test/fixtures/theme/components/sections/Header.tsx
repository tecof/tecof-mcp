"use client";

import { useCart } from "@/lib/cart/CartProvider";
import { cn } from "@/lib/cn";
import { renderSlot, type SlotRenderer } from "@/lib/renderSlot";
import { Menu, ShoppingBag, X } from "lucide-react";
import { useState } from "react";

type HeaderProps = {
  className?: string;
  logoSlot?: SlotRenderer;
  navSlot?: SlotRenderer;
  ctaSlot?: SlotRenderer;
};

const defaultNavLink = (
  id: string,
  tr: string,
  en: string,
  trUrl: string,
  enUrl: string
) => ({
  type: "NavLink",
  props: {
    id,
    label: [
      { code: "tr", value: tr },
      { code: "en", value: en },
    ],
    href: [
      { code: "tr", value: { url: trUrl, target: "_self" } },
      { code: "en", value: { url: enUrl, target: "_self" } },
    ],
  },
});

const HeaderRender = (props: Record<string, unknown>) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const headerProps = props as HeaderProps;

  // Sepet — editörden açılıp kapanır (website temalarında "Hayır" seçilir).
  // CartProvider layout'ta hazır; provider yoksa useCart güvenli no-op döner.
  const { totalItems, openCart } = useCart();
  const showCart = (props as any).showCart === "yes";

  const { logoSlot, navSlot, ctaSlot } = headerProps;

  return (
    <>
      <header
        className={cn(
          "sticky top-0 w-full z-50 bg-white/80 backdrop-blur-xl border-b border-gray-100/80",
          headerProps.className
        )}
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 lg:h-[76px] gap-4">
            {/* Sol: Logo ve Mobil Menü Butonu */}
            <div className="flex items-center gap-4">
              <button
                className="lg:hidden p-2 -ml-2 text-gray-700 hover:text-gray-900 transition-colors"
                onClick={() => setMobileOpen(true)}
                aria-label="Menüyü aç"
              >
                <Menu className="h-5 w-5" strokeWidth={1.5} />
              </button>
              <div className="flex items-center">
                {renderSlot(logoSlot)}
              </div>
            </div>

            {/* Orta: Desktop Nav */}
            <nav className="hidden lg:flex items-center gap-1">
              {renderSlot(navSlot, {
                className: "flex items-center gap-1",
              })}
            </nav>

            {/* Sağ: CTA (opsiyonel) + Sepet (editörden aç/kapa) */}
            <div className="flex items-center justify-end gap-4">
              <div className="hidden sm:block">
                {renderSlot(ctaSlot)}
              </div>
              {showCart && (
                <button
                  onClick={openCart}
                  className="relative p-2 text-gray-800 hover:text-gray-950 transition-colors"
                  aria-label="Sepeti aç"
                >
                  <ShoppingBag className="h-[22px] w-[22px]" strokeWidth={1.5} />
                  {totalItems > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[17px] h-[17px] px-1 text-[10px] font-semibold bg-gray-950 text-white rounded-full">
                      {totalItems}
                    </span>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Overlay */}
      <div
        className={`fixed inset-0 z-50 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
        onClick={() => setMobileOpen(false)}
      />

      {/* Mobile Drawer */}
      <div
        className={`fixed top-0 right-0 z-50 h-full w-[85%] max-w-sm bg-white shadow-2xl transform transition-transform duration-300 ease-out ${mobileOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex items-center justify-between px-5 h-16 border-b border-gray-100">
          <span className="text-sm font-semibold text-gray-900">Menü</span>
          <button
            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-50 rounded-xl transition-colors"
            onClick={() => setMobileOpen(false)}
            aria-label="Menüyü kapat"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav
          className="flex flex-col gap-1 p-4"
          onClick={(e) => {
            // Slot içindeki herhangi bir bağlantıya tıklanınca çekmeceyi kapat.
            if ((e.target as Element).closest("a")) setMobileOpen(false);
          }}
        >
          {renderSlot(navSlot, {
            className: "flex flex-col gap-1",
          })}
          <div className="mt-4 flex flex-col items-center">
            {renderSlot(ctaSlot)}
          </div>
        </nav>
      </div>
    </>
  );
};

export const Header = {
  label: "Header",

  fields: {
    logoSlot: {
      type: "slot" as const,
      label: "Logo / Marka Alanı",
      allow: ["Logo", "Title", "Picture"],
    },
    navSlot: {
      type: "slot" as const,
      label: "Menü Öğeleri",
      allow: ["NavLink"],
      orientation: "horizontal" as const,
    },
    ctaSlot: {
      type: "slot" as const,
      label: "CTA Butonu",
      allow: ["Button"],
    },
    // E-ticaret temalarında "Evet" — website temalarında "Hayır" seçilir.
    // Sepet ikonu CartDrawerSection'ın çekmecesini açar (useCart.openCart).
    showCart: {
      type: "radio",
      label: "Sepet İkonu Göster",
      options: [
        { label: "Evet", value: "yes" },
        { label: "Hayır", value: "no" },
      ],
    },
  },

  defaultProps: {
    id: "Header-1",
    showCart: "no",
    logoSlot: [
      {
        type: "Logo",
        props: {
          id: "header-logo",
          media: [
            {
              _id: "default-logo-svg",
              name: "logo.svg",
              type: "external",
              url: "/logo.svg",
              provider: "external"
            }
          ],
          text: [
            { code: "tr", value: "Tecof" },
            { code: "en", value: "Tecof" },
          ],
          href: [{ code: "tr", value: { url: "/", target: "_self" } }],
        },
      },
    ] as unknown as SlotRenderer,
    navSlot: [
      defaultNavLink("header-nav-shop", "Mağaza", "Shop", "/koleksiyon", "/collection"),
      defaultNavLink("header-nav-about", "Hakkımızda", "About", "/hakkimizda", "/about"),
      defaultNavLink("header-nav-blog", "Blog", "Blog", "/blog", "/blog"),
      defaultNavLink("header-nav-contact", "İletişim", "Contact", "/iletisim", "/contact"),
    ] as unknown as SlotRenderer,
    ctaSlot: [
      {
        type: "Button",
        props: {
          id: "header-cta",
          label: [
            { code: "tr", value: "Koleksiyonu İncele" },
            { code: "en", value: "View Collection" },
          ],
          href: [{ code: "tr", value: { url: "/koleksiyon", target: "_self" } }],
          variant: "underline",
        },
      },
    ] as unknown as SlotRenderer,
  },

  render: HeaderRender,
};

export default Header;
