// Shared pieces every screen is built from, so they all look and move the same way.
// Controls are shadcn/ui components (components/ui); Motion (motion.dev) does the animation, with one
// spring and one ease used everywhere.

import { AnimatePresence, motion, MotionConfig, useReducedMotion, useSpring, type HTMLMotionProps, type Transition } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { Item } from '../shared/types';
import { Button as ShadcnButton } from './components/ui/button';
import { Icon } from './icons';
import { ItemBadge, titleOf } from './visuals';

export { AnimatePresence, motion };

export const spring: Transition = { type: 'spring', stiffness: 420, damping: 36, mass: 0.8 };
export const ease: Transition = { duration: 0.32, ease: [0.22, 1, 0.36, 1] };

/** Wrap a screen: respects "Reduce motion" and uses the house spring by default. */
export function Motion({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={spring}>
      {children}
    </MotionConfig>
  );
}

const MotionButton = motion.create(ShadcnButton);
const VARIANTS = { primary: 'default', secondary: 'secondary', ghost: 'ghost', danger: 'destructive' } as const;

type ButtonProps = HTMLMotionProps<'button'> & { variant?: keyof typeof VARIANTS; size?: 'small' | 'normal' };

/** shadcn's Button with a soft press. */
export function Button({ variant = 'secondary', size = 'normal', type = 'button', ...rest }: ButtonProps) {
  return <MotionButton type={type} whileTap={{ scale: 0.97 }} variant={VARIANTS[variant]} size={size === 'small' ? 'sm' : 'default'} {...rest} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}

export type Mood = 'awake' | 'sleep' | 'happy' | 'curious' | 'wide';

/** The app icon in miniature: a white folder on butter yellow, talking through its eyes only.
 *  Most folders on screen are still (closed while stashed, open while in use). One folder per window is
 *  `alive`: it blinks now and then, follows your cursor, looks where `lookAt` points, notices when you
 *  hover it, and shows a mood (happy on save, curious while unsure, wide-eyed on pick-up).
 *  Going to sleep the eyes squish shut and the closed curves draw in, as on design/brand.html. */
export function FolderMark({
  size = 28,
  awake = false,
  mood,
  alive = false,
  lookAt,
  tone,
}: {
  size?: number;
  awake?: boolean;
  mood?: Mood;
  alive?: boolean;
  /** Something the folder should look at instead of the cursor. */
  lookAt?: RefObject<HTMLElement | null> | null;
  tone?: { tile: string; flap: string };
}) {
  const reduce = useReducedMotion();
  const ref = useRef<SVGSVGElement>(null);
  const shown: Mood = mood ?? (awake ? 'awake' : 'sleep');
  const open = shown !== 'sleep' && shown !== 'happy';
  const lively = alive && !reduce;
  const blinking = useBlink(lively && open);
  const lingering = useLinger(ref, lively && open);
  const gaze = useGaze(ref, lively && open, lookAt);
  const scale = (left: boolean) => {
    if (!open) return 0.06;
    if (blinking) return 0.12;
    if (lingering) return 0.45;
    if (shown === 'wide') return 1.25;
    if (shown === 'curious') return left ? 0.7 : 1.12;
    return 1;
  };
  return (
    <svg ref={ref} className="folder-mark" width={size} height={size} viewBox="0 0 96 96" aria-hidden="true">
      <rect width="96" height="96" rx="22" fill={tone?.tile ?? '#F2CD5C'} />
      <path d="M16 33 Q16 25 24 25 H37 Q41 25 43.5 28.5 L46.5 32 H72 Q80 32 80 40 V70 Q80 78 72 78 H24 Q16 78 16 70 Z" fill={tone?.flap ?? '#FBEFC6'} />
      <path d="M16 45 Q16 39 22 39 H74 Q80 39 80 45 V70 Q80 78 72 78 H24 Q16 78 16 70 Z" fill="#FFFFFF" />
      <motion.g fill="#1C1D22" style={{ x: gaze.x, y: gaze.y }}>
        {[37, 59].map((cx) => (
          <motion.ellipse
            key={cx}
            cx={cx}
            cy="59"
            rx="3.6"
            ry="4.2"
            style={{ transformBox: 'fill-box', transformOrigin: '50% 70%' }}
            initial={false}
            animate={{ scaleY: scale(cx === 37), scaleX: shown === 'wide' && !blinking ? 1.2 : 1, opacity: open ? 1 : 0 }}
            transition={
              blinking
                ? { duration: 0.08 }
                : open
                  ? { scaleY: { duration: 0.42, ease: [0.25, 1.6, 0.45, 1] }, scaleX: { duration: 0.3 }, opacity: { duration: 0.05 } }
                  : { scaleY: { duration: 0.28, ease: [0.55, 0, 0.8, 0.3] }, opacity: { duration: 0.08, delay: 0.24 } }
            }
          />
        ))}
      </motion.g>
      <g fill="none" stroke="#1C1D22" strokeWidth="3.4" strokeLinecap="round">
        {/* Closed while stashed: soft curves down. Happy: the same curves turned up. */}
        {[
          ['M32 58 Q37 63 42 58', 'sleep'],
          ['M54 58 Q59 63 64 58', 'sleep'],
          ['M32 61 Q37 55 42 61', 'happy'],
          ['M54 61 Q59 55 64 61', 'happy'],
        ].map(([d, when]) => (
          <motion.path
            key={d}
            d={d}
            initial={false}
            animate={{ pathLength: shown === when ? 1 : 0, opacity: shown === when ? 1 : 0 }}
            transition={
              shown === when ? { pathLength: { duration: 0.2, delay: 0.22, ease: 'easeOut' }, opacity: { duration: 0.01, delay: 0.22 } } : { duration: 0.12 }
            }
          />
        ))}
      </g>
    </svg>
  );
}

/** True for a moment every 3 to 7 seconds (and now and then twice in a row). */
function useBlink(on: boolean): boolean {
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (!on) return;
    let t: ReturnType<typeof setTimeout>;
    const blink = (then: () => void) => {
      setClosed(true);
      t = setTimeout(() => {
        setClosed(false);
        then();
      }, 130);
    };
    const schedule = () => {
      t = setTimeout(() => blink(() => (Math.random() < 0.25 ? (t = setTimeout(() => blink(schedule), 180)) : schedule())), 3000 + Math.random() * 4000);
    };
    schedule();
    return () => clearTimeout(t);
  }, [on]);
  return closed;
}

/** True once the pointer has rested on the folder for a while: it squints back at you. */
function useLinger(ref: RefObject<SVGSVGElement | null>, on: boolean): boolean {
  const [lingering, setLingering] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!on || !el) return setLingering(false);
    let t: ReturnType<typeof setTimeout>;
    const enter = () => (t = setTimeout(() => setLingering(true), 1800));
    const leave = () => {
      clearTimeout(t);
      setLingering(false);
    };
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointerleave', leave);
    return () => {
      clearTimeout(t);
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointerleave', leave);
    };
  }, [ref, on]);
  return lingering;
}

/** Where the eyes point, in the icon's 96-unit space: toward `lookAt` when given, otherwise the cursor,
 *  and back to the middle when the pointer leaves the window. Springs keep it soft. */
function useGaze(ref: RefObject<SVGSVGElement | null>, on: boolean, lookAt?: RefObject<HTMLElement | null> | null) {
  const x = useSpring(0, { stiffness: 260, damping: 26 });
  const y = useSpring(0, { stiffness: 260, damping: 26 });
  useEffect(() => {
    const el = ref.current;
    const aim = (px: number, py: number) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = px - (r.left + r.width / 2);
      const dy = py - (r.top + r.height * 0.6);
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 160);
      x.set((dx / d) * 7.5 * k);
      y.set((dy / d) * 4.5 * k);
    };
    const rest = () => {
      x.set(0);
      y.set(0);
    };
    if (!on) return rest();
    const target = lookAt?.current;
    if (target) {
      const r = target.getBoundingClientRect();
      aim(r.left + r.width / 2, r.top + r.height / 2);
      return;
    }
    const move = (e: PointerEvent) => aim(e.clientX, e.clientY);
    window.addEventListener('pointermove', move);
    document.documentElement.addEventListener('pointerleave', rest);
    return () => {
      window.removeEventListener('pointermove', move);
      document.documentElement.removeEventListener('pointerleave', rest);
    };
  }, [ref, on, lookAt, x, y]);
  return { x, y };
}

/** Content that slides open and closed, height and all. */
export function Reveal({ show, children, className }: { show: boolean; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          className={className}
          style={{ overflow: 'hidden' }}
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={ease}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** One screen replacing another: a short fade and slide. */
export function Swap({ id, children, direction = 1 }: { id: string; children: ReactNode; direction?: 1 | -1 }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={id}
        initial={{ opacity: 0, x: 18 * direction }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -18 * direction }}
        transition={ease}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/** A tab, file or app you can put in a folder or leave out. */
export function Pill({ item, on, front, tip, onToggle }: { item: Item; on: boolean; front: boolean; tip: string; onToggle: () => void }) {
  return (
    <motion.button
      layout
      type="button"
      className={`pill ${on ? 'in' : 'out'}`}
      onClick={onToggle}
      title={tip}
      aria-pressed={on}
      whileTap={{ scale: 0.95 }}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      <span className="pill-mark">
        <Icon name="check" className="i mark-check" />
        <Icon name="plus" className="i mark-plus" />
      </span>
      <ItemBadge item={item} size={16} />
      <span className="pill-label">{titleOf(item)}</span>
      {item.notOpen && <span className="pill-tag">closed</span>}
      {front && <span className="pill-dot" title="You were on this last" />}
    </motion.button>
  );
}

/** "3 tabs · 1 file" */
export function countText(items: Item[]): string {
  const docs = items.filter((i) => i.kind === 'doc' || i.kind === 'folder').length;
  const tabs = items.filter((i) => i.kind === 'tab').length;
  const apps = items.filter((i) => i.kind === 'app').length;
  const parts = [];
  if (tabs) parts.push(`${tabs} ${tabs === 1 ? 'tab' : 'tabs'}`);
  if (docs) parts.push(`${docs} ${docs === 1 ? 'file' : 'files'}`);
  if (apps) parts.push(`${apps} ${apps === 1 ? 'app' : 'apps'}`);
  return parts.join(' · ') || 'Nothing picked';
}
