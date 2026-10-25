// shadcn/ui Button, themed for Stashd: butter yellow with ink for the main action, white glass for the rest.
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium border-0 transition-[background,box-shadow,color] duration-200 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.45),inset_0_0_0_0.5px_rgba(150,110,0,0.25),0_4px_14px_rgba(214,170,40,0.28)] hover:bg-[#f5d672]',
        secondary: 'bg-secondary text-secondary-foreground shadow-[inset_0_0.5px_0_var(--rim),inset_0_0_0_0.5px_var(--hair)] hover:bg-accent',
        ghost: 'bg-transparent text-muted-foreground hover:bg-secondary hover:text-foreground',
        destructive: 'bg-transparent text-destructive hover:bg-[color-mix(in_srgb,var(--danger)_14%,transparent)]',
        link: 'bg-transparent text-[var(--accent-ink)] font-semibold underline-offset-4 hover:underline p-0 h-auto',
      },
      size: {
        default: 'h-8 px-3.5',
        sm: 'h-7 px-2.5 text-xs',
        lg: 'h-10 px-5 text-sm',
        icon: 'size-7 p-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

function Button({ className, variant, size, asChild = false, ...props }: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
