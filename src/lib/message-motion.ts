import type { MessageEffect } from "./widget";

/**
 * CSS-класс анимации появления.
 * Используем CSS, а не framer-motion initial/animate: иначе при каждом
 * обновлении настроек (например, смене цвета) React пересоздаёт props
 * анимации и эффект «не применяется» к уже видимым строкам и выглядит
 * как будто настройка не синхронизируется.
 */
export function getMessageEffectClass(effect: MessageEffect | undefined): string {
  switch (effect) {
    case "fade":
      return "msg-fx msg-fx-fade";
    case "slide-up":
      return "msg-fx msg-fx-slide-up";
    case "slide-left":
      return "msg-fx msg-fx-slide-left";
    case "scale":
      return "msg-fx msg-fx-scale";
    case "pop":
      return "msg-fx msg-fx-pop";
    case "bounce":
      return "msg-fx msg-fx-bounce";
    default:
      return "";
  }
}

/** Совместимость со старым API (предпросмотр в настройках). */
export function getMessageMotion(effect: MessageEffect, duration: number, delay = 0) {
  const transition = {
    duration: effect === "none" ? 0 : duration,
    delay,
    ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
  };
  switch (effect) {
    case "fade":
      return { initial: { opacity: 0 }, animate: { opacity: 1 }, transition };
    case "slide-up":
      return { initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, transition };
    case "slide-left":
      return { initial: { opacity: 0, x: 42 }, animate: { opacity: 1, x: 0 }, transition };
    case "scale":
      return { initial: { opacity: 0, scale: 0.86 }, animate: { opacity: 1, scale: 1 }, transition };
    case "pop":
      return {
        initial: { opacity: 0, scale: 0.72, rotate: -1.5 },
        animate: { opacity: 1, scale: [0.72, 1.04, 1], rotate: 0 },
        transition,
      };
    case "bounce":
      return {
        initial: { opacity: 0, y: 30, scale: 0.94 },
        animate: { opacity: [0, 1, 1], y: [30, -5, 0], scale: [0.94, 1.02, 1] },
        transition,
      };
    default:
      return { initial: false as const, animate: {}, transition };
  }
}