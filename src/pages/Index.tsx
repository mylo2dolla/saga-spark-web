import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { 
  Swords, 
  Users, 
  Sparkles, 
  Dices, 
  BookOpen, 
  Shield,
  Scroll,
  Wand2,
  ArrowRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Logo from "@/components/Logo";
import FeatureCard from "@/components/FeatureCard";
import DiceRoller from "@/components/DiceRoller";
import heroBg from "@/assets/hero-bg.jpg";

const features = [
  {
    icon: Sparkles,
    title: "AI Dungeon Master",
    description: "Experience dynamic storytelling with an AI that narrates, plays NPCs, enforces rules, and remembers your entire campaign history."
  },
  {
    icon: Users,
    title: "Real-time Multiplayer",
    description: "Join campaigns with friends via invite codes. Chat and play together with instant WebSocket updates across all devices."
  },
  {
    icon: Swords,
    title: "Tactical Combat",
    description: "Engage in turn-based battles with initiative tracking, HP bars, and animated miniatures on a visual tabletop."
  },
  {
    icon: Wand2,
    title: "Infinite Classes",
    description: "Create any character class imaginable — from ninjas to time travelers. The AI dynamically interprets abilities and stats."
  },
  {
    icon: Shield,
    title: "Deep Progression",
    description: "Level up, unlock ability slots, equip infinite items, and watch your character evolve with AI-generated visuals."
  },
  {
    icon: Dices,
    title: "Full Dice System",
    description: "Roll d4 through d20 with visual feedback. Critical hits, fumbles, and modifiers all handled automatically."
  }
];

const Index = () => {
  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 glass-dark">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Logo size="md" />
          <div className="flex items-center gap-4">
            <Link to="/login">
              <Button variant="ghost" size="sm">Login</Button>
            </Link>
            <Link to="/signup">
              <Button variant="outline" size="sm">Sign Up</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center justify-center pt-20">
        {/* Background Image */}
        <div className="absolute inset-0 z-0">
          <img 
            src={heroBg} 
            alt="Fantasy adventurers" 
            className="w-full h-full object-cover opacity-40"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/80 to-background" />
        </div>

        <div className="container mx-auto px-4 z-10 text-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <div className="flex justify-center mb-6">
              <Logo size="lg" />
            </div>
            
            <h1 className="font-display text-4xl md:text-6xl lg:text-7xl font-bold text-foreground mb-4">
              Your AI <span className="text-primary text-glow-gold">Dungeon Master</span>
            </h1>
            
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-8 font-narrative">
              Embark on infinite adventures with friends. Create any character, explore boundless worlds, 
              and let artificial intelligence weave your epic tale.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link to="/signup">
                <Button variant="hero" size="xl">
                  Begin Your Quest
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </Link>
              <Link to="/login">
                <Button variant="glass" size="lg">
                  Continue Adventure
                </Button>
              </Link>
            </div>
          </motion.div>

          {/* Floating Dice Demo */}
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="mt-16 max-w-xs mx-auto"
          >
            <DiceRoller compact />
          </motion.div>
        </div>

        {/* Scroll indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2"
        >
          <motion.div
            animate={{ y: [0, 10, 0] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="text-muted-foreground"
          >
            <Scroll className="w-6 h-6" />
          </motion.div>
        </motion.div>
      </section>

      {/* Features Section */}
      <section className="py-24 relative">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-4">
              Forge Your <span className="text-primary">Legend</span>
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Everything you need for an immersive tabletop RPG experience, powered by AI
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, index) => (
              <FeatureCard 
                key={feature.title} 
                {...feature} 
                delay={index * 0.1} 
              />
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 relative">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/10 via-arcane/10 to-primary/10" />
        <div className="container mx-auto px-4 relative z-10">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="card-parchment rounded-2xl p-8 md:p-12 text-center max-w-3xl mx-auto"
          >
            <BookOpen className="w-12 h-12 text-primary mx-auto mb-6" />
            <h2 className="font-display text-2xl md:text-3xl font-bold text-foreground mb-4">
              Ready to Write Your Story?
            </h2>
            <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
              Join thousands of adventurers already exploring infinite worlds. 
              Create your free account and start your first campaign in minutes.
            </p>
            <Link to="/signup">
              <Button variant="hero" size="xl">
                Create Free Account
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t border-border">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <Logo size="sm" />
            <p className="text-sm text-muted-foreground">
              © 2024 MythWeaver. All realms reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
