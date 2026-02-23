
-- ============================================================
-- FRIENDSHIPS TABLE
-- ============================================================
-- Directional request model: one row per request.
-- status = 'accepted' means mutual friendship.
-- ============================================================

CREATE TABLE public.friendships (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  requester_user_id UUID NOT NULL,
  addressee_user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CONSTRAINT friendships_status_check CHECK (status IN ('pending', 'accepted', 'declined', 'blocked')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  responded_at TIMESTAMP WITH TIME ZONE,
  -- prevent self-requests
  CONSTRAINT friendships_no_self CHECK (requester_user_id != addressee_user_id),
  -- prevent duplicate active rows between same pair
  CONSTRAINT friendships_unique_pair UNIQUE (requester_user_id, addressee_user_id)
);

-- Indexes for lookup
CREATE INDEX idx_friendships_addressee ON public.friendships (addressee_user_id, status);
CREATE INDEX idx_friendships_requester ON public.friendships (requester_user_id, status);

-- Trigger for updated_at
CREATE TRIGGER update_friendships_updated_at
  BEFORE UPDATE ON public.friendships
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- SECURITY DEFINER: check if two users are accepted friends
-- Used by RLS on books to avoid cross-table policy issues.
-- ============================================================
CREATE OR REPLACE FUNCTION public.are_friends(user_a UUID, user_b UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.friendships
    WHERE status = 'accepted'
      AND (
        (requester_user_id = user_a AND addressee_user_id = user_b)
        OR (requester_user_id = user_b AND addressee_user_id = user_a)
      )
  );
$$;

-- ============================================================
-- FRIENDSHIPS RLS POLICIES
-- ============================================================

-- Users can see friendship rows they are part of
CREATE POLICY "Users can view own friendships"
  ON public.friendships FOR SELECT
  USING (auth.uid() = requester_user_id OR auth.uid() = addressee_user_id);

-- Users can send friend requests (requester must be self)
CREATE POLICY "Users can send friend requests"
  ON public.friendships FOR INSERT
  WITH CHECK (auth.uid() = requester_user_id AND status = 'pending');

-- Addressee can accept/decline pending requests; either party can update accepted->removed via delete
CREATE POLICY "Users can update friendships"
  ON public.friendships FOR UPDATE
  USING (
    -- addressee can respond to pending requests
    (auth.uid() = addressee_user_id AND status = 'pending')
    OR
    -- either party can update accepted friendships (for removal)
    ((auth.uid() = requester_user_id OR auth.uid() = addressee_user_id) AND status = 'accepted')
  );

-- Either party can delete (remove friendship / cancel request)
CREATE POLICY "Users can delete own friendships"
  ON public.friendships FOR DELETE
  USING (auth.uid() = requester_user_id OR auth.uid() = addressee_user_id);

-- ============================================================
-- ADD comment_visibility TO books
-- ============================================================
ALTER TABLE public.books
  ADD COLUMN comment_visibility TEXT NOT NULL DEFAULT 'private'
    CONSTRAINT books_comment_visibility_check CHECK (comment_visibility IN ('private', 'friends', 'community'));

-- Backfill: set existing comments based on profile visibility
-- Public profiles with comments -> 'community', others stay 'private'
UPDATE public.books b
  SET comment_visibility = 'community'
  WHERE b.user_comment IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = b.user_id AND p.is_public = true
    );

-- ============================================================
-- UPDATE BOOKS RLS: add friend-visible and community-visible comment access
-- ============================================================

-- New policy: friends can view books where comment_visibility = 'friends'
CREATE POLICY "Friends can view friend-visible books"
  ON public.books FOR SELECT
  USING (
    comment_visibility = 'friends'
    AND public.are_friends(auth.uid(), user_id)
  );

-- Note: existing "Public users books are viewable by everyone" policy
-- already handles community-visible books via profiles.is_public.
-- community-visible comments are served through that existing policy.
