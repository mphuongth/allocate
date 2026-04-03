import { Link } from 'react-router';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { ExternalLink } from 'lucide-react';

export function NavigationShowcase() {
  const pages = [
    {
      title: 'Landing Page',
      description: 'Hero section with features and CTA',
      path: '/landing',
      color: 'bg-gradient-to-br from-violet-500 to-purple-600'
    },
    {
      title: 'Sign In',
      description: 'Authentication page for existing users',
      path: '/signin',
      color: 'bg-gradient-to-br from-blue-500 to-indigo-600'
    },
    {
      title: 'Sign Up',
      description: 'Registration page for new users',
      path: '/signup',
      color: 'bg-gradient-to-br from-green-500 to-emerald-600'
    },
    {
      title: 'Modal Showcase',
      description: 'Preview all 13 redesigned modals',
      path: '/modal-showcase',
      color: 'bg-gradient-to-br from-amber-500 to-orange-600'
    },
    {
      title: 'Dashboard',
      description: 'Main application dashboard',
      path: '/',
      color: 'bg-gradient-to-br from-rose-500 to-pink-600'
    }
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Navigation Showcase</h1>
        <p className="text-gray-500 mt-2">Explore all pages and features</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {pages.map((page) => (
          <Card key={page.path} className="overflow-hidden">
            <div className={`h-32 ${page.color} flex items-center justify-center`}>
              <div className="text-white text-4xl font-bold opacity-20">FM</div>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">{page.title}</h3>
                <p className="text-sm text-gray-600">{page.description}</p>
              </div>
              <Link to={page.path}>
                <Button className="w-full gap-2 bg-violet-600 hover:bg-violet-700">
                  View Page
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-6 bg-blue-50 border-blue-200">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500 text-white flex-shrink-0">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h4 className="font-medium text-blue-900 mb-1">Quick Navigation</h4>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• <strong>Modal Showcase:</strong> Access via the link above or navigate to /modal-showcase</li>
              <li>• <strong>Auth Pages:</strong> View landing, sign in, and sign up pages</li>
              <li>• <strong>Dashboard:</strong> Main application with Asset Overview, Monthly Plan, etc.</li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}
