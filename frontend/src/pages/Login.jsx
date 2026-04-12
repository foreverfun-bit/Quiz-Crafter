import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "../App";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Loader2 } from "lucide-react";

const Login = () => {
  const { user, login, register, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  
  // Login form state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  
  // Register form state
  const [registerName, setRegisterName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#09090B] flex items-center justify-center">
        <div className="spinner"></div>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

const handleLogin = async (e) => {
  e.preventDefault();
  setLoading(true);
  const result = await login(loginEmail, loginPassword);
  setLoading(false);
  if (result.success) {
    navigate("/");
  }
};

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);
    const result = await register(registerEmail, registerPassword, registerName);
    setLoading(false);
    if (result.success) {
      navigate("/");
    }
  };

  return (
    <div className="min-h-screen bg-[#09090B] flex items-center justify-center p-4">
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#71E0DC]/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[#AEB2EF]/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <img 
            src="https://customer-assets.emergentagent.com/job_trivia-forge-2/artifacts/pdn53z7h_4ever-full-gradient.svg"
            alt="4EVER Trivia"
            className="w-20 h-20 mx-auto mb-4"
          />
          <h1 className="text-3xl font-bold gradient-text font-heading">Quiz Crafter</h1>
          <p className="text-zinc-500 mt-2">Craft unforgettable trivia experiences</p>
        </div>

        <Card className="bg-zinc-900/50 border-white/10 backdrop-blur-sm">
          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2 bg-zinc-800/50">
              <TabsTrigger value="login" data-testid="login-tab">Login</TabsTrigger>
              <TabsTrigger value="register" data-testid="register-tab">Register</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <CardHeader>
                <CardTitle className="text-white">Welcome back</CardTitle>
                <CardDescription className="text-zinc-500">
                  Sign in to access your trivia library
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-email" className="text-zinc-300">Email</Label>
                    <Input
                      id="login-email"
                      type="email"
                      placeholder="you@example.com"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      required
                      className="bg-zinc-950/50 border-white/10 focus:border-[#71E0DC] text-white"
                      data-testid="login-email-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password" className="text-zinc-300">Password</Label>
                    <Input
                      id="login-password"
                      type="password"
                      placeholder="••••••••"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      required
                      className="bg-zinc-950/50 border-white/10 focus:border-[#71E0DC] text-white"
                      data-testid="login-password-input"
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full gradient-btn"
                    data-testid="login-submit-btn"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Signing in...
                      </>
                    ) : (
                      "Sign In"
                    )}
                  </Button>
                </form>
              </CardContent>
            </TabsContent>

            <TabsContent value="register">
              <CardHeader>
                <CardTitle className="text-white">Create account</CardTitle>
                <CardDescription className="text-zinc-500">
                  Start building your trivia empire
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleRegister} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="register-name" className="text-zinc-300">Name</Label>
                    <Input
                      id="register-name"
                      type="text"
                      placeholder="John Doe"
                      value={registerName}
                      onChange={(e) => setRegisterName(e.target.value)}
                      required
                      className="bg-zinc-950/50 border-white/10 focus:border-[#71E0DC] text-white"
                      data-testid="register-name-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="register-email" className="text-zinc-300">Email</Label>
                    <Input
                      id="register-email"
                      type="email"
                      placeholder="you@example.com"
                      value={registerEmail}
                      onChange={(e) => setRegisterEmail(e.target.value)}
                      required
                      className="bg-zinc-950/50 border-white/10 focus:border-[#71E0DC] text-white"
                      data-testid="register-email-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="register-password" className="text-zinc-300">Password</Label>
                    <Input
                      id="register-password"
                      type="password"
                      placeholder="••••••••"
                      value={registerPassword}
                      onChange={(e) => setRegisterPassword(e.target.value)}
                      required
                      minLength={6}
                      className="bg-zinc-950/50 border-white/10 focus:border-[#71E0DC] text-white"
                      data-testid="register-password-input"
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full gradient-btn"
                    data-testid="register-submit-btn"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Creating account...
                      </>
                    ) : (
                      "Create Account"
                    )}
                  </Button>
                </form>
              </CardContent>
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </div>
  );
};

export default Login;
