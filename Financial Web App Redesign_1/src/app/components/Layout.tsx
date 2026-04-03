import { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router';
import { Moon, Sun, LogOut, LayoutDashboard, Calendar, LineChart, Settings as SettingsIcon } from 'lucide-react';
import { Button } from './ui/button';

const navigation = [
  { name: 'Asset Overview', path: '/', icon: LayoutDashboard },
  { name: 'Monthly Plan', path: '/monthly-plan', icon: Calendar },
  { name: 'Fund Library', path: '/fund-library', icon: LineChart },
  { name: 'Settings', path: '/settings', icon: SettingsIcon },
];

export function Layout() {
  const location = useLocation();
  const [isDark, setIsDark] = useState(false);

  const toggleTheme = () => {
    setIsDark(!isDark);
    document.documentElement.classList.toggle('dark');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r bg-white">
        <div className="flex h-full flex-col">
          {/* Logo */}
          <div className="flex h-16 items-center border-b px-6">
            <h1 className="text-xl font-semibold text-violet-600">Allocate</h1>
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-1 p-4">
            {navigation.map((item) => {
              const isActive = location.pathname === item.path || 
                (item.path !== '/' && location.pathname.startsWith(item.path));
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-violet-50 text-violet-600'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <item.icon className="h-5 w-5" />
                  {item.name}
                </Link>
              );
            })}
          </nav>

          {/* User section */}
          <div className="border-t p-4">
            <div className="flex items-center gap-3 rounded-lg bg-gray-50 p-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 text-sm font-medium text-white">
                M
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">nghiavuive@jp</p>
                <p className="text-xs text-gray-500">EN • VI</p>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="pl-64">
        {/* Header */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-white px-8">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-medium text-gray-900">
              {navigation.find(n => n.path === location.pathname)?.name || 'Settings'}
            </h2>
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="h-9 w-9"
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-2"
            >
              <LogOut className="h-4 w-4" />
              Đăng xuất
            </Button>
          </div>
        </header>

        {/* Page content */}
        <main className="p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
