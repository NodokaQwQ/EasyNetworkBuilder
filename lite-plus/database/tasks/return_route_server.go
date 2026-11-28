package tasks

import (
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/nuomiiiii/lite/database/dbcore"
	"github.com/nuomiiiii/lite/database/models"
	"github.com/nuomiiiii/lite/utils"
	"gorm.io/gorm"
)

// A server task is an aggregate of independently identified targets. Keeping the
// probe IDs means old agents, event links and measurement histories remain valid.
type ReturnRouteServerTask struct {
	Client                             string                    `json:"client"`
	Name                               string                    `json:"name"`
	Interval                           int                       `json:"interval"`
	PingInterval                       int                       `json:"ping_interval"`
	SwitchConfirm                      int                       `json:"switch_confirm"`
	RecoveryConfirm                    int                       `json:"recovery_confirm"`
	Cooldown                           int                       `json:"cooldown"`
	Notify                             bool                      `json:"notify"`
	NotifyRecovery                     bool                      `json:"notify_recovery"`
	MainlandReachabilityEnabled        bool                      `json:"mainland_reachability_enabled"`
	MainlandReachabilityNotify         bool                      `json:"mainland_reachability_notify"`
	MainlandReachabilityRecoveryNotify bool                      `json:"mainland_reachability_recovery_notify"`
	Enabled                            bool                      `json:"enabled"`
	Targets                            []ReturnRouteServerTarget `json:"targets"`
	ExistingTargetIDs                  []uint                    `json:"existing_target_ids"`
}

type ReturnRouteServerTarget struct {
	ID           uint   `json:"id"`
	Target       string `json:"target"`
	Carrier      string `json:"carrier"`
	ExpectedLine string `json:"expected_line"`
	IPVersion    int    `json:"ip_version"`
	Region       string `json:"region"`
}

type ReturnRouteServerPage struct {
	Servers  []ReturnRouteTaskPage `json:"servers"`
	Total    int64                 `json:"total"`
	Page     int                   `json:"page"`
	PageSize int                   `json:"page_size"`
}

func QueryReturnRouteServers(params ReturnRouteTaskQuery) (ReturnRouteServerPage, error) {
	return queryReturnRouteServers(dbcore.GetDBInstance(), params)
}

func queryReturnRouteServers(db *gorm.DB, params ReturnRouteTaskQuery) (ReturnRouteServerPage, error) {
	page, size := normalizeReturnRoutePagination(params.Page, params.PageSize)
	result := ReturnRouteServerPage{Servers: []ReturnRouteTaskPage{}, Page: page, PageSize: size}
	filtered, err := filterReturnRouteTasks(db.Model(&models.ReturnRouteTask{}), params, db)
	if err != nil {
		return result, err
	}
	if err := db.Table("(?) AS matching_servers", filtered.Select("DISTINCT client")).Count(&result.Total).Error; err != nil {
		return result, err
	}
	var clients []string
	if err := filtered.Distinct("client").Order("client ASC").Limit(size).Offset((page-1)*size).Pluck("client", &clients).Error; err != nil {
		return result, err
	}
	for _, client := range clients {
		// Filters select servers, not individual rows: never hide a sibling
		// target from an edit or split one server across pagination boundaries.
		group := ReturnRouteTaskPage{Tasks: []models.ReturnRouteTask{}, Statuses: []models.ReturnRouteStatus{}, ProbingTaskIDs: []uint{}}
		if err := db.Preload("ClientInfo").Where("client = ?", client).Order("id ASC").Find(&group.Tasks).Error; err != nil {
			return result, err
		}
		ids := make([]uint, 0, len(group.Tasks))
		for _, task := range group.Tasks {
			ids = append(ids, task.Id)
		}
		if err := db.Where("task_id IN ?", ids).Find(&group.Statuses).Error; err != nil {
			return result, err
		}
		group.Reachability, err = reachabilityViewsForTasks(db, group.Tasks)
		if err != nil {
			return result, err
		}
		for _, id := range utils.ProbingReturnRouteTaskIDs() {
			for _, taskID := range ids {
				if id == taskID {
					group.ProbingTaskIDs = append(group.ProbingTaskIDs, id)
				}
			}
		}
		result.Servers = append(result.Servers, group)
	}
	return result, nil
}

func SaveReturnRouteServer(params ReturnRouteServerTask) error {
	if err := saveReturnRouteServer(dbcore.GetDBInstance(), params); err != nil {
		return err
	}
	return ReloadReturnRouteSchedule()
}

func saveReturnRouteServer(db *gorm.DB, params ReturnRouteServerTask) error {
	if len(params.Targets) == 0 || len(params.Targets) > 64 {
		return fmt.Errorf("每台服务器需配置 1 至 64 个探测目标")
	}
	params.Client = strings.TrimSpace(params.Client)
	return db.Transaction(func(tx *gorm.DB) error {
		var existing []models.ReturnRouteTask
		if err := tx.Where("client = ?", params.Client).Find(&existing).Error; err != nil {
			return err
		}
		base := uniqueReturnRouteTaskIDs(params.ExistingTargetIDs)
		if len(base) != len(existing) {
			return fmt.Errorf("服务器目标列表已变化或已存在任务，请刷新后编辑，避免覆盖已有目标")
		}
		baseIDs := map[uint]bool{}
		for _, id := range base {
			baseIDs[id] = true
		}
		for _, task := range existing {
			if !baseIDs[task.Id] {
				return fmt.Errorf("服务器目标列表已变化，请刷新后重试")
			}
		}
		byID := make(map[uint]models.ReturnRouteTask, len(existing))
		for _, task := range existing {
			byID[task.Id] = task
		}
		candidates := make([]models.ReturnRouteTask, 0, len(params.Targets))
		seenIDs := map[uint]bool{}
		seenSlots := map[string]bool{}
		for _, target := range params.Targets {
			previous, ok := byID[target.ID]
			if target.ID != 0 && (!ok || seenIDs[target.ID]) {
				return fmt.Errorf("目标 ID 不属于当前服务器或重复")
			}
			seenIDs[target.ID] = true
			task := models.ReturnRouteTask{
				Id: target.ID, Name: params.Name, Client: params.Client,
				Target: target.Target, Carrier: target.Carrier, ExpectedLine: target.ExpectedLine, IPVersion: target.IPVersion, Region: target.Region,
				Protocol: "icmp", Interval: params.Interval, PingInterval: params.PingInterval,
				SwitchConfirm: params.SwitchConfirm, RecoveryConfirm: params.RecoveryConfirm, Cooldown: params.Cooldown,
				Notify: params.Notify, NotifyRecovery: params.NotifyRecovery, Enabled: params.Enabled,
				MainlandReachabilityEnabled:        params.MainlandReachabilityEnabled,
				MainlandReachabilityNotify:         params.MainlandReachabilityNotify,
				MainlandReachabilityRecoveryNotify: params.MainlandReachabilityRecoveryNotify,
				MainlandReachabilityPingTaskID:     previous.MainlandReachabilityPingTaskID,
			}
			if err := normalizeReturnRouteTaskWithDB(tx, &task); err != nil {
				return err
			}
			if err := validateReturnRouteServerTarget(task); err != nil {
				return err
			}
			// One IP/domain and address family has exactly one carrier/line.
			key := strings.ToLower(task.Target) + fmt.Sprint(":", task.IPVersion)
			if seenSlots[key] {
				return fmt.Errorf("同一地址类型下不能重复配置目标 %s", task.Target)
			}
			seenSlots[key] = true
			candidates = append(candidates, task)
		}
		var removed []uint
		for _, previous := range existing {
			if !seenIDs[previous.Id] {
				removed = append(removed, previous.Id)
			}
		}
		if len(removed) > 0 {
			if err := deleteReturnRouteTasks(tx, removed); err != nil {
				return err
			}
		}
		for i := range candidates {
			task := &candidates[i]
			if task.Id == 0 {
				if err := createReturnRouteTask(tx, task); err != nil {
					return err
				}
			} else {
				previous := byID[task.Id]
				if err := tx.Model(task).Updates(returnRouteTaskColumnUpdates(*task)).Error; err != nil {
					return err
				}
				if previous.Target != task.Target || previous.Carrier != task.Carrier || previous.ExpectedLine != task.ExpectedLine || previous.IPVersion != task.IPVersion {
					if err := tx.Where("task_id = ?", task.Id).Delete(&models.ReturnRouteStatus{}).Error; err != nil {
						return err
					}
					if err := tx.Where("task_id = ?", task.Id).Delete(&models.ReturnRouteProbeSample{}).Error; err != nil {
						return err
					}
				}
				if err := syncReturnRoutePing(tx, task); err != nil {
					return err
				}
			}
		}
		all := append(existing, candidates...)
		return recomputeMainlandReachabilityKeys(tx, mainlandKeysFromTasks(all), time.Now().UTC())
	})
}

func validateReturnRouteServerTarget(task models.ReturnRouteTask) error {
	if ip := net.ParseIP(task.Target); ip != nil {
		if (ip.To4() != nil) != (task.IPVersion == 4) {
			return fmt.Errorf("目标 %s 与 IPv%d 地址类型不匹配", task.Target, task.IPVersion)
		}
	} else {
		host := strings.TrimSuffix(task.Target, ".")
		if len(host) == 0 || len(host) > 253 {
			return fmt.Errorf("无效的目标域名")
		}
		for _, label := range strings.Split(host, ".") {
			if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
				return fmt.Errorf("无效的目标域名 %s", task.Target)
			}
			for _, c := range label {
				if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-') {
					return fmt.Errorf("目标须为 IP 或域名，不包含协议、端口或路径")
				}
			}
		}
	}
	lines := map[string][]string{
		"mobile":  {"CMIN2", "CMI", "CMNET"},
		"telecom": {"CN2 GIA", "CN2 GT", "163"},
		"unicom":  {"CUG VIP", "CUG 优化", "9929", "4837"},
	}
	for _, line := range lines[task.Carrier] {
		if line == task.ExpectedLine {
			return nil
		}
	}
	return fmt.Errorf("预期线路 %s 不属于运营商 %s", task.ExpectedLine, task.Carrier)
}
