'use client';
// src/components/layout/Sidebar.tsx
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, KanbanSquare, Upload, History,
  CalendarCheck, Settings, Zap,
} from 'lucide-react';

const NAV = [
  { href: '/dashboard', label: 'Dashboard',      icon: LayoutDashboard },
  { href: '/pipeline',  label: 'Pipeline',        icon: KanbanSquare },
  { href: '/import',    label: 'Importer CSV',    icon: Upload },
  { href: '/history',   label: 'Historique',      icon: History },
  { href: '/actions',   label: 'Actions',         icon: CalendarCheck },
  { href: '/settings',  label: 'Paramètres',      icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-52 flex-shrink-0 flex flex-col bg-white border-r border-slate-200 h-screen sticky top-0">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-slate-200">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <Zap size={16} className="text-white" />
          </div>
          <div>
            <div className="font-semibold text-sm text-slate-900">CRM Magasins</div>
            <div className="text-xs text-slate-400">v2 · Offres emploi</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-3 flex flex-col gap-0.5 overflow-y-auto">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={`nav-item${active ? ' active' : ''}`}
            >
              <Icon size={15} className="flex-shrink-0" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-slate-200 text-xs text-slate-400">
        Données en temps réel
      </div>
    </aside>
  );
}
