CREATE INDEX `idx_events_nonphantom_stream_sequence` ON `events` (`stream_id`,`sequence`) WHERE NOT (
  type='AttentionEpisodeObserved'
  AND COALESCE(json_extract(payload,'$.capture_version'),'') IN ('attention-v1','attention-v2')
  AND COALESCE(json_extract(payload,'$.terminal_type'),'')='idle_timeout'
  AND COALESCE(json_extract(payload,'$.terminal_ref'),'')=''
  AND COALESCE(CAST(json_extract(payload,'$.active_ms') AS REAL),-1)=30000
  AND COALESCE(CAST(json_extract(payload,'$.idle_ms') AS REAL),-1)>=30000
  AND COALESCE(json_extract(payload,'$.surface'),'')<>''
  AND COALESCE(json_extract(payload,'$.context'),'')=COALESCE(json_extract(payload,'$.surface'),'')||'-overview'
  AND COALESCE(json_type(payload,'$.visible_refs'),'')='array'
  AND json_array_length(payload,'$.visible_refs')=0
  AND COALESCE(CAST(json_extract(payload,'$.friction_score') AS REAL),0)<.45
  AND COALESCE(CAST(json_extract(payload,'$.outcome_weight') AS REAL),0)<.18
);