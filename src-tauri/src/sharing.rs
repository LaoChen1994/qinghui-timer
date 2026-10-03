use crate::timer::{Store, Timer};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SharedTimer {
    pub name: String,
    pub minutes: u32,
    pub started_at: u64,
    pub deadline: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SharedFile {
    pub format: String,
    pub version: u32,
    pub exported_at: u64,
    pub timers: Vec<SharedTimer>,
}

impl SharedFile {
    pub fn validate(&self) -> Result<(), String> {
        if self.format != "qinghui-timer" || self.version != 1 {
            return Err("这不是支持的青回传世计时分享文件（需要格式版本 1）".into());
        }
        if self.exported_at > 8_640_000_000_000_000 {
            return Err("导出时间戳超出支持范围".into());
        }
        for (index, timer) in self.timers.iter().enumerate() {
            if timer.name.trim().is_empty()
                || timer.name != timer.name.trim()
                || timer.name.chars().count() > 40
                || !(1..=1440).contains(&timer.minutes)
                || timer.deadline > 8_640_000_000_000_000
                || timer
                    .started_at
                    .checked_add(u64::from(timer.minutes) * 60_000)
                    != Some(timer.deadline)
            {
                return Err(format!(
                    "第 {} 条记录无效：请检查名称、周期及毫秒时间戳，刷新时间应等于上次重置时间加刷新周期",
                    index + 1
                ));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "action",
    rename_all = "lowercase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ImportChoice {
    Add,
    Keep,
    Replace {
        target_id: u64,
        expected_deadline: u64,
    },
}

#[derive(Debug, Default, Serialize)]
pub struct ImportSummary {
    pub added: usize,
    pub updated: usize,
    pub kept: usize,
}

impl Store {
    pub fn merge_shared(
        &self,
        file: &SharedFile,
        choices: &[ImportChoice],
        now: u64,
    ) -> Result<(Store, ImportSummary), String> {
        file.validate()?;
        if choices.len() != file.timers.len() {
            return Err("请为每条导入记录选择处理方式".into());
        }
        let mut targets = HashSet::new();
        for (incoming, choice) in file.timers.iter().zip(choices) {
            match choice {
                ImportChoice::Add => {
                    if self.timers.iter().any(|timer| timer.name == incoming.name) {
                        return Err(format!(
                            "「{}」已有同名记录，请选择覆盖目标或保留",
                            incoming.name
                        ));
                    }
                }
                ImportChoice::Replace {
                    target_id,
                    expected_deadline,
                } => {
                    let current = self
                        .timers
                        .iter()
                        .find(|timer| timer.id == *target_id)
                        .ok_or("覆盖目标已被删除，请重新检查导入选择")?;
                    if current.name != incoming.name || current.deadline != *expected_deadline {
                        return Err("覆盖目标已改变，请重新检查当前刷新时间后再确认".into());
                    }
                    if !targets.insert(*target_id) {
                        return Err("多条导入记录不能同时覆盖同一条本地记录，请重新选择".into());
                    }
                }
                ImportChoice::Keep => {}
            }
        }

        let mut store = self.clone();
        let mut summary = ImportSummary::default();
        for (incoming, choice) in file.timers.iter().zip(choices) {
            let expired = incoming.deadline <= now;
            match choice {
                ImportChoice::Keep => summary.kept += 1,
                ImportChoice::Add => {
                    store.next_id = store.next_id.checked_add(1).ok_or("计时记录编号超出范围")?;
                    store.timers.push(Timer {
                        id: store.next_id,
                        name: incoming.name.clone(),
                        minutes: incoming.minutes,
                        started_at: incoming.started_at,
                        deadline: incoming.deadline,
                        warned: expired,
                        refreshed: expired,
                    });
                    summary.added += 1;
                }
                ImportChoice::Replace { target_id, .. } => {
                    let timer = store
                        .timers
                        .iter_mut()
                        .find(|timer| timer.id == *target_id)
                        .expect("覆盖目标已经校验");
                    if timer.minutes == incoming.minutes
                        && timer.started_at == incoming.started_at
                        && timer.deadline == incoming.deadline
                    {
                        summary.kept += 1;
                        continue;
                    }
                    timer.minutes = incoming.minutes;
                    timer.started_at = incoming.started_at;
                    timer.deadline = incoming.deadline;
                    timer.warned = expired;
                    timer.refreshed = expired;
                    store.alerts.retain(|alert| alert.timer_id != *target_id);
                    summary.updated += 1;
                }
            }
        }
        Ok((store, summary))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_retains_absolute_deadlines_and_does_not_export_local_flags() {
        let file = SharedFile {
            format: "qinghui-timer".into(),
            version: 1,
            exported_at: 1_000,
            timers: vec![SharedTimer {
                name: "逆魔".into(),
                minutes: 40,
                started_at: 1_000,
                deadline: 2_401_000,
            }],
        };
        let json = serde_json::to_string(&file).unwrap();
        assert!(!json.contains("warned"));
        assert!(!json.contains("refreshed"));
        let restored: SharedFile = serde_json::from_str(&json).unwrap();
        let (store, summary) = Store::default()
            .merge_shared(&restored, &[ImportChoice::Add], 601_000)
            .unwrap();
        assert_eq!(summary.added, 1);
        assert_eq!(store.timers[0].deadline, 2_401_000);
        assert_eq!(store.timers[0].deadline - 601_000, 1_800_000);
    }

    #[test]
    fn overwrite_and_keep_preserve_unselected_records_and_cancel_old_alerts() {
        let mut original = Store::default();
        original.add("逆魔", 3, 0).unwrap();
        original.add("通天教主", 3, 0).unwrap();
        original.advance(0);
        let file = SharedFile {
            format: "qinghui-timer".into(),
            version: 1,
            exported_at: 1_000,
            timers: vec![
                SharedTimer {
                    name: "逆魔".into(),
                    minutes: 60,
                    started_at: 1_000,
                    deadline: 3_601_000,
                },
                SharedTimer {
                    name: "通天教主".into(),
                    minutes: 90,
                    started_at: 1_000,
                    deadline: 5_401_000,
                },
            ],
        };
        let (store, summary) = original
            .merge_shared(
                &file,
                &[
                    ImportChoice::Replace {
                        target_id: 1,
                        expected_deadline: 180_000,
                    },
                    ImportChoice::Keep,
                ],
                10_000,
            )
            .unwrap();
        assert_eq!(summary.updated, 1);
        assert_eq!(summary.kept, 1);
        assert_eq!(store.timers.len(), 2);
        assert_eq!(store.timers[0].id, 1);
        assert_eq!(store.timers[0].deadline, 3_601_000);
        assert_eq!(store.timers[1].deadline, 180_000);
        assert_eq!(store.alerts.len(), 1);
        assert_eq!(store.alerts[0].timer_id, 2);
        assert_eq!(original.timers[0].deadline, 180_000);
    }

    #[test]
    fn same_name_targets_are_explicit_and_duplicate_or_stale_targets_are_rejected() {
        let mut original = Store::default();
        original.add("逆魔", 40, 0).unwrap();
        original.add("逆魔", 60, 0).unwrap();
        let mut file = SharedFile {
            format: "qinghui-timer".into(),
            version: 1,
            exported_at: 1_000,
            timers: vec![SharedTimer {
                name: "逆魔".into(),
                minutes: 90,
                started_at: 1_000,
                deadline: 5_401_000,
            }],
        };
        assert!(original
            .merge_shared(&file, &[ImportChoice::Add], 10_000)
            .is_err());
        assert!(original
            .merge_shared(
                &file,
                &[ImportChoice::Replace {
                    target_id: 2,
                    expected_deadline: 1
                }],
                10_000
            )
            .is_err());
        let (store, _) = original
            .merge_shared(
                &file,
                &[ImportChoice::Replace {
                    target_id: 2,
                    expected_deadline: 3_600_000,
                }],
                10_000,
            )
            .unwrap();
        assert_eq!(store.timers[0].deadline, 2_400_000);
        assert_eq!(store.timers[1].deadline, 5_401_000);
        file.timers.push(file.timers[0].clone());
        assert!(original
            .merge_shared(
                &file,
                &[
                    ImportChoice::Replace {
                        target_id: 1,
                        expected_deadline: 2_400_000
                    },
                    ImportChoice::Replace {
                        target_id: 1,
                        expected_deadline: 2_400_000
                    },
                ],
                10_000
            )
            .is_err());
    }

    #[test]
    fn expired_imports_are_ready_without_emitting_historical_reminders() {
        let file = SharedFile {
            format: "qinghui-timer".into(),
            version: 1,
            exported_at: 1_000,
            timers: vec![SharedTimer {
                name: "逆魔".into(),
                minutes: 1,
                started_at: 1_000,
                deadline: 61_000,
            }],
        };
        let (mut store, _) = Store::default()
            .merge_shared(&file, &[ImportChoice::Add], 100_000)
            .unwrap();
        assert!(store.timers[0].refreshed);
        assert!(store.advance(101_000).is_empty());
        store.reset(1, 101_000).unwrap();
        assert_eq!(store.advance(101_000).len(), 1);
    }

    #[test]
    fn identical_overwrite_preserves_acknowledged_reminder_flags() {
        let mut original = Store::default();
        original.add("逆魔", 40, 1_000).unwrap();
        original.advance(2_221_000);
        original.alerts.clear();
        let file = SharedFile {
            format: "qinghui-timer".into(),
            version: 1,
            exported_at: 2_222_000,
            timers: vec![SharedTimer {
                name: "逆魔".into(),
                minutes: 40,
                started_at: 1_000,
                deadline: 2_401_000,
            }],
        };
        let (mut store, summary) = original
            .merge_shared(
                &file,
                &[ImportChoice::Replace {
                    target_id: 1,
                    expected_deadline: 2_401_000,
                }],
                2_222_000,
            )
            .unwrap();
        assert_eq!(summary.kept, 1);
        assert!(store.advance(2_223_000).is_empty());
    }

    #[test]
    fn malformed_files_and_invalid_timestamps_cannot_modify_records() {
        assert!(serde_json::from_str::<SharedFile>("{not-json}").is_err());
        let mut original = Store::default();
        original.add("逆魔", 40, 0).unwrap();
        let mut file = SharedFile {
            format: "qinghui-timer".into(),
            version: 1,
            exported_at: 1_000,
            timers: vec![SharedTimer {
                name: "禁地魔王".into(),
                minutes: 40,
                started_at: 1_000,
                deadline: 2_401_000,
            }],
        };
        file.version = 2;
        assert!(file.validate().is_err());
        file.version = 1;
        file.timers[0].deadline = 1_790_995_000;
        assert!(original
            .merge_shared(&file, &[ImportChoice::Add], 1_000)
            .is_err());
        file.timers[0].started_at = u64::MAX;
        assert!(file.validate().is_err());
        assert_eq!(original.timers.len(), 1);
        assert_eq!(original.next_id, 1);
    }
}
