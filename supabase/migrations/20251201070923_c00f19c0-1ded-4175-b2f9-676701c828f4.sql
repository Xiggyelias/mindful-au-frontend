-- Create app role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'counselor', 'student');

-- Create profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  full_name TEXT,
  id_number TEXT,
  email TEXT,
  avatar_url TEXT,
  anonymous_mode BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create user_roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  approved BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  UNIQUE (user_id, role)
);

-- Create sessions table (counseling sessions)
CREATE TABLE public.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  counselor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'cancelled')),
  session_type TEXT DEFAULT 'chat' CHECK (session_type IN ('chat', 'video', 'voice')),
  notes TEXT,
  ai_summary TEXT,
  started_at TIMESTAMP WITH TIME ZONE,
  ended_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create messages table
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE NOT NULL,
  sender_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL,
  message_type TEXT DEFAULT 'text' CHECK (message_type IN ('text', 'voice', 'file', 'ai')),
  file_url TEXT,
  is_encrypted BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create ai_diagnostics table
CREATE TABLE public.ai_diagnostics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
  stress_level INTEGER CHECK (stress_level >= 0 AND stress_level <= 100),
  anxiety_level INTEGER CHECK (anxiety_level >= 0 AND anxiety_level <= 100),
  depression_level INTEGER CHECK (depression_level >= 0 AND depression_level <= 100),
  mood TEXT,
  risk_level TEXT CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  insights TEXT,
  recommendations TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create counselor_wellness_logs table
CREATE TABLE public.counselor_wellness_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  counselor_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  mood_score INTEGER CHECK (mood_score >= 0 AND mood_score <= 100),
  stress_level INTEGER CHECK (stress_level >= 0 AND stress_level <= 100),
  burnout_index INTEGER CHECK (burnout_index >= 0 AND burnout_index <= 100),
  recommendations TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create panic_logs table
CREATE TABLE public.panic_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  location TEXT,
  resolved BOOLEAN DEFAULT false,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create notifications table
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'info' CHECK (type IN ('info', 'warning', 'success', 'error', 'panic')),
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create appointments table
CREATE TABLE public.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  counselor_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  duration_minutes INTEGER DEFAULT 60,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'confirmed', 'completed', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_diagnostics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.counselor_wellness_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.panic_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

-- Create has_role function for secure role checking
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role AND approved = true
  )
$$;

-- Profiles policies
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Counselors can view student profiles" ON public.profiles FOR SELECT USING (public.has_role(auth.uid(), 'counselor'));

-- User roles policies
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own role" ON public.user_roles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can manage all roles" ON public.user_roles FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Sessions policies
CREATE POLICY "Students can view own sessions" ON public.sessions FOR SELECT USING (auth.uid() = student_id);
CREATE POLICY "Counselors can view assigned sessions" ON public.sessions FOR SELECT USING (auth.uid() = counselor_id OR public.has_role(auth.uid(), 'counselor'));
CREATE POLICY "Students can create sessions" ON public.sessions FOR INSERT WITH CHECK (auth.uid() = student_id);
CREATE POLICY "Counselors can update sessions" ON public.sessions FOR UPDATE USING (auth.uid() = counselor_id OR public.has_role(auth.uid(), 'counselor'));
CREATE POLICY "Admins can view all sessions" ON public.sessions FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- Messages policies
CREATE POLICY "Session participants can view messages" ON public.messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.sessions WHERE id = session_id AND (student_id = auth.uid() OR counselor_id = auth.uid()))
);
CREATE POLICY "Session participants can send messages" ON public.messages FOR INSERT WITH CHECK (
  auth.uid() = sender_id AND EXISTS (SELECT 1 FROM public.sessions WHERE id = session_id AND (student_id = auth.uid() OR counselor_id = auth.uid()))
);

-- AI diagnostics policies
CREATE POLICY "Students can view own diagnostics" ON public.ai_diagnostics FOR SELECT USING (auth.uid() = student_id);
CREATE POLICY "Counselors can view diagnostics" ON public.ai_diagnostics FOR SELECT USING (public.has_role(auth.uid(), 'counselor'));
CREATE POLICY "Admins can view all diagnostics" ON public.ai_diagnostics FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- Counselor wellness policies
CREATE POLICY "Counselors can view own wellness" ON public.counselor_wellness_logs FOR SELECT USING (auth.uid() = counselor_id);
CREATE POLICY "Counselors can insert own wellness" ON public.counselor_wellness_logs FOR INSERT WITH CHECK (auth.uid() = counselor_id);
CREATE POLICY "Admins can view all wellness logs" ON public.counselor_wellness_logs FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- Panic logs policies
CREATE POLICY "Students can create panic logs" ON public.panic_logs FOR INSERT WITH CHECK (auth.uid() = student_id);
CREATE POLICY "Students can view own panic logs" ON public.panic_logs FOR SELECT USING (auth.uid() = student_id);
CREATE POLICY "Counselors can view panic logs" ON public.panic_logs FOR SELECT USING (public.has_role(auth.uid(), 'counselor'));
CREATE POLICY "Counselors can update panic logs" ON public.panic_logs FOR UPDATE USING (public.has_role(auth.uid(), 'counselor'));
CREATE POLICY "Admins can manage all panic logs" ON public.panic_logs FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Notifications policies
CREATE POLICY "Users can view own notifications" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own notifications" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);

-- Appointments policies
CREATE POLICY "Students can view own appointments" ON public.appointments FOR SELECT USING (auth.uid() = student_id);
CREATE POLICY "Students can create appointments" ON public.appointments FOR INSERT WITH CHECK (auth.uid() = student_id);
CREATE POLICY "Counselors can view their appointments" ON public.appointments FOR SELECT USING (auth.uid() = counselor_id OR public.has_role(auth.uid(), 'counselor'));
CREATE POLICY "Counselors can update appointments" ON public.appointments FOR UPDATE USING (auth.uid() = counselor_id);
CREATE POLICY "Admins can manage all appointments" ON public.appointments FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Enable realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- Create trigger for updating profiles timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Create function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email)
  VALUES (NEW.id, NEW.raw_user_meta_data ->> 'full_name', NEW.email);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();