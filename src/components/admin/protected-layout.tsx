
'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Settings,
  Bell,
  FileText,
  ShieldCheck,
  KeyRound,
  LogOut,
  User,
  FileCog,
  BadgeAlert
} from 'lucide-react';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Logo } from '@/components/icons';
import { useAuth } from '@/hooks/use-auth';
import type { LoanProvider } from '@/lib/types';
import { cn } from '@/lib/utils';
import { allMenuItems } from '@/lib/menu-items';


// Function to convert hex to HSL
const hexToHsl = (hex: string): string => {
  hex = hex.replace(/^#/, '');
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }

  return `${(h * 360).toFixed(0)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%`;
}

interface ProtectedLayoutProps {
  children: React.ReactNode;
  providers: LoanProvider[];
}

export function ProtectedLayout({ children, providers }: ProtectedLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { currentUser, logout, isLoading } = useAuth();

  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);

  const currentMenuItem = React.useMemo(() => {
    let best: (typeof allMenuItems)[number] | undefined;
    for (const item of allMenuItems) {
      if (pathname.startsWith(item.path) && (!best || item.path.length > best.path.length)) {
        best = item;
      }
    }
    return best;
  }, [pathname]);

  React.useEffect(() => {
    if (!isLoading && !currentUser && pathname !== '/admin/login') {
      router.push('/admin/login');
    }
  }, [currentUser, isLoading, pathname, router]);

  const providerColorHsl = React.useMemo(() => {
    let colorHex = '#fdb913'; // Default color
    if (currentUser?.role === 'Admin' || currentUser?.role === 'Super Admin') {
      colorHex = providers.find((p) => p.name === 'NIb Bank')?.colorHex || '#fdb913';
    } else {
       colorHex = providers.find((p) => p.name === currentUser?.providerName)?.colorHex || '#fdb913';
    }
    return hexToHsl(colorHex);
  }, [currentUser, providers]);

  const getInitials = (name: string = '') =>
    name
      .split(' ')
      .map((n) => n[0])
      .join('');

  const menuItems = React.useMemo(() => {
    if (!currentUser || !currentUser.permissions) return [];
    
    return allMenuItems.filter((item) => {
        const moduleName = item.label.toLowerCase().replace(/\s+/g, '-');
        // Fallback for roles that might not have all permission keys yet
        return currentUser.permissions[moduleName]?.read;
    });

  }, [currentUser]);

  // Check whether the current route is allowed for the user. If they don't
  // have read permission for the current module, we'll redirect to the
  // forbidden page to prevent client-side navigation to restricted pages.
  const isCurrentRouteAllowed = React.useMemo(() => {
    if (!currentUser || !currentUser.permissions) return false;
    const current = currentMenuItem;
    if (!current) return true; // allow non-admin menu routes (handled elsewhere)
    const moduleName = current.label.toLowerCase().replace(/\s+/g, '-');
    return !!currentUser.permissions[moduleName]?.read;
  }, [currentUser, currentMenuItem]);

  const handleLogout = async () => {
    await logout();
    router.push('/admin/login');
  };

  const handleChangePassword = () => {
    router.push('/admin/change-password');
  };

  if (pathname === '/admin/login' || pathname?.startsWith('/admin/change-password')) {
    return <>{children}</>;
  }

  if (isLoading || !currentUser) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p>Loading user data...</p>
      </div>
    );
  }
  
  const luminance = (hsl: string) => {
    const l = parseFloat(hsl.split(' ')[2]);
    return l;
  }

  return (
    <SidebarProvider>
      <div className="bg-muted/40 min-h-screen w-full flex" style={{
         '--sidebar-accent': providerColorHsl,
         '--sidebar-accent-foreground': luminance(providerColorHsl) > 50 ? '0 0% 0%' : '0 0% 100%',
      } as React.CSSProperties}>
        <Sidebar>
          <SidebarHeader>
            <SidebarTrigger>
              <Logo className="h-6 w-6" />
            </SidebarTrigger>
          </SidebarHeader>
          <SidebarContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.label}>
                  <Link href={item.path}>
                    <SidebarMenuButton
                      isActive={pathname.startsWith(item.path) && (item.path !== '/admin' || pathname === '/admin')}
                      tooltip={{
                        children: item.label,
                      }}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </Link>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
        <div className="flex flex-col flex-1 min-w-0">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background px-4 sm:px-6 justify-end">
            <Button variant="outline" size="icon" className="h-8 w-8">
              <Bell className="h-4 w-4" />
              <span className="sr-only">Toggle notifications</span>
            </Button>
            {mounted && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="overflow-hidden rounded-full"
                  >
                    <Avatar>
                      <AvatarImage
                        src={`/avatars/shadcn.png`}
                        alt={currentUser?.fullName || ''}
                      />
                      <AvatarFallback>
                        {getInitials(currentUser?.fullName || '')}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{currentUser?.fullName}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleChangePassword} className="focus:bg-sidebar-accent focus:text-sidebar-accent-foreground">
                    <KeyRound className="mr-2 h-4 w-4" />
                    <span>Change Password</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleLogout} className="focus:bg-sidebar-accent focus:text-sidebar-accent-foreground">
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Logout</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </header>
          <main className="flex-1 overflow-x-auto">
            {!isCurrentRouteAllowed ? (
              <div className="p-8">
                <h1 className="text-2xl font-semibold">Unauthorized</h1>
                <p className="text-sm text-muted-foreground mb-4">
                  You do not have permission to view this page.
                </p>
              </div>
            ) : (
              children
            )}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
