import { Link } from 'react-router';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { TrendingUp, PieChart, Target, Shield, Clock, BarChart3 } from 'lucide-react';

export function LandingPage() {
  const features = [
    {
      icon: <PieChart className="h-8 w-8" />,
      title: 'Asset Overview',
      description: 'Visualize your complete financial picture with interactive charts and real-time tracking'
    },
    {
      icon: <Target className="h-8 w-8" />,
      title: 'Goal Management',
      description: 'Set and track financial goals across different asset types with progress monitoring'
    },
    {
      icon: <TrendingUp className="h-8 w-8" />,
      title: 'Investment Tracking',
      description: 'Monitor fund investments, bank deposits, and gold holdings in one unified dashboard'
    },
    {
      icon: <BarChart3 className="h-8 w-8" />,
      title: 'Monthly Planning',
      description: 'Plan and allocate your monthly income with automatic fixed expense management'
    },
    {
      icon: <Clock className="h-8 w-8" />,
      title: 'Auto-Populate',
      description: 'Fixed expenses and insurance fees automatically added to your monthly plans'
    },
    {
      icon: <Shield className="h-8 w-8" />,
      title: 'Insurance Tracking',
      description: 'Manage family insurance policies with annual to monthly fee calculations'
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-purple-50 to-pink-50">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-violet-600 to-purple-600 flex items-center justify-center text-white font-bold text-xl">
                FM
              </div>
              <span className="text-xl font-bold text-gray-900">Finance Manager</span>
            </div>
            <div className="flex items-center gap-4">
              <Link to="/signin">
                <Button variant="ghost">Sign In</Button>
              </Link>
              <Link to="/signup">
                <Button className="bg-violet-600 hover:bg-violet-700">Get Started</Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-32">
        <div className="text-center space-y-8">
          <div className="space-y-4">
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-gray-900 leading-tight">
              Take Control of Your
              <span className="bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent"> Financial Future</span>
            </h1>
            <p className="text-xl md:text-2xl text-gray-600 max-w-3xl mx-auto">
              All-in-one platform to manage investments, track goals, and plan your monthly finances with ease
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link to="/signup">
              <Button size="lg" className="bg-violet-600 hover:bg-violet-700 text-lg px-8 py-6">
                Start Free Trial
              </Button>
            </Link>
            <Button size="lg" variant="outline" className="text-lg px-8 py-6">
              Watch Demo
            </Button>
          </div>

          <div className="pt-8">
            <p className="text-sm text-gray-500 mb-4">Trusted by thousands of users</p>
            <div className="flex items-center justify-center gap-8 opacity-50">
              <div className="text-2xl font-bold text-gray-400">₫ 500B+</div>
              <div className="h-8 w-px bg-gray-300"></div>
              <div className="text-2xl font-bold text-gray-400">10K+</div>
              <div className="h-8 w-px bg-gray-300"></div>
              <div className="text-2xl font-bold text-gray-400">50K+</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">Everything You Need</h2>
          <p className="text-xl text-gray-600">Powerful features to manage your finances effectively</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature, index) => (
            <Card key={index} className="p-6 hover:shadow-lg transition-shadow border-2 border-transparent hover:border-violet-200">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-violet-100 text-violet-600 flex-shrink-0">
                  {feature.icon}
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-2">{feature.title}</h3>
                  <p className="text-sm text-gray-600">{feature.description}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* CTA Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <Card className="bg-gradient-to-br from-violet-600 to-purple-600 border-none p-12 md:p-16 text-center">
          <h2 className="text-4xl font-bold text-white mb-4">Ready to Get Started?</h2>
          <p className="text-xl text-violet-100 mb-8 max-w-2xl mx-auto">
            Join thousands of users who are already managing their finances smarter
          </p>
          <Link to="/signup">
            <Button size="lg" className="bg-white text-violet-600 hover:bg-gray-100 text-lg px-8 py-6">
              Create Free Account
            </Button>
          </Link>
        </Card>
      </section>

      {/* Footer */}
      <footer className="border-t bg-white/80 backdrop-blur-sm mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center">
            <div className="flex items-center justify-center gap-2 mb-4">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-600 to-purple-600 flex items-center justify-center text-white font-bold">
                FM
              </div>
              <span className="text-lg font-bold text-gray-900">Finance Manager</span>
            </div>
            <p className="text-gray-600 text-sm">
              © 2026 Finance Manager. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
