"use client";

import { cn } from "@/lib/cn";
import { renderSlot, type SlotRenderer } from "@/lib/renderSlot";
import { motion } from "framer-motion";

export const HeroCentered = {
  label: "Hero Centered",

  fields: {
    contentSlot: {
      type: "slot" as const,
      label: "İçerik Elementleri",
      allow: ["Title", "Paragraph", "Button", "Column", "Spacer", "Divider", "Row", "Video"],
    },
  },

  defaultProps: {
    id: "HeroCentered-1",
    contentSlot: [
      {
        type: "Column",
        props: {
          id: "hero-centered-column",
          align: "center",
          gap: "md",
          contentSlot: [
            {
              type: "Title",
              props: {
                id: "hero-centered-eyebrow",
                text: [
                  { code: "tr", value: "2025 Koleksiyonu" },
                  { code: "en", value: "2025 Collection" },
                ],
                size: "xs",
                align: "center",
              },
            },
            {
              type: "Title",
              props: {
                id: "hero-centered-title",
                text: [
                  { code: "tr", value: "Tasarımın Özüne Yolculuk" },
                  { code: "en", value: "A Journey to the Essence of Design" },
                ],
                size: "lg",
                align: "center",
              },
            },
            {
              type: "Paragraph",
              props: {
                id: "hero-centered-desc",
                text: [
                  { code: "tr", value: "<p>Her ürünümüz, doğal malzemeler ve özenli işçilikle hayat buluyor. Sıradanın ötesinde, zamansız tasarımlar.</p>" },
                  { code: "en", value: "<p>Each of our products is brought to life with natural materials and careful craftsmanship. Beyond the ordinary, timeless designs.</p>" },
                ],
                tone: "muted",
                align: "center",
              },
            },
            {
              type: "Button",
              props: {
                id: "hero-centered-btn-1",
                label: [
                  { code: "tr", value: "Koleksiyonu İncele" },
                  { code: "en", value: "View Collection" },
                ],
                href: [{ code: "tr", value: { url: "/koleksiyon", target: "_self" } }],
                variant: "solid",
                align: "center",
              },
            },
          ] as unknown as SlotRenderer,
        },
      },
    ] as unknown as SlotRenderer,
  },

  render: (props: any) => {
    const staggerContainer = {
      hidden: {},
      show: { transition: { staggerChildren: 0.15 } },
    };
    const fadeUp = {
      hidden: { opacity: 0, y: 30 },
      show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
    };

    return (
      <section className={cn("relative overflow-hidden bg-white py-20 lg:py-32 flex items-center justify-center", props.className)}>
        <div className="relative mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 text-center flex flex-col items-center">
          <motion.div
            className="flex flex-col items-center gap-6"
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            viewport={{ once: true, amount: 0.3 }}
          >
            <motion.div variants={fadeUp} className="flex flex-col items-center gap-6 w-full">
              {renderSlot(props.contentSlot, { className: "flex flex-col items-center gap-6 text-center" })}
            </motion.div>
          </motion.div>
        </div>
      </section>
    );
  },
};

export default HeroCentered;
