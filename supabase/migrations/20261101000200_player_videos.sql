-- Player videos: MP4 or MOV clips up to 500 MB, kept with each player's photos.
alter type public.player_asset_kind add value if not exists 'video';

update storage.buckets set file_size_limit = 524288000 where id = 'staging';
update storage.buckets
  set file_size_limit = 524288000,
      allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/quicktime']
  where id = 'players';
