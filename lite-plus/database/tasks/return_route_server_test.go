package tasks

import (
	"testing"
	"time"

	"github.com/nuomiiiii/lite/database/models"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func newReturnRouteServerTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, _ := seedReturnRouteQueryData(t)
	require.NoError(t, db.AutoMigrate(&models.PingLossNotification{}, &models.MetricCleanupJob{}))
	return db
}

func serverParams(t *testing.T, db *gorm.DB, client string) ReturnRouteServerTask {
	t.Helper()
	var rows []models.ReturnRouteTask
	require.NoError(t, db.Where("client = ?", client).Find(&rows).Error)
	params := ReturnRouteServerTask{Client: client, Name: "server routes", Interval: 180,
		SwitchConfirm: 2, RecoveryConfirm: 3, Cooldown: 1800, Enabled: true}
	for _, row := range rows {
		params.ExistingTargetIDs = append(params.ExistingTargetIDs, row.Id)
		params.Targets = append(params.Targets, ReturnRouteServerTarget{ID: row.Id, Target: row.Target, Carrier: row.Carrier, ExpectedLine: row.ExpectedLine, IPVersion: row.IPVersion, Region: row.Region})
	}
	return params
}

func TestServerTaskMultiTargetLifecycle(t *testing.T) {
	db := newReturnRouteServerTestDB(t)
	p := serverParams(t, db, "node-a")
	p.Targets = append(p.Targets, ReturnRouteServerTarget{Target: "mobile.example.com", Carrier: "mobile", ExpectedLine: "CMIN2", IPVersion: 4})
	require.NoError(t, saveReturnRouteServer(db, p))
	var rows []models.ReturnRouteTask
	require.NoError(t, db.Where("client = ?", "node-a").Order("id").Find(&rows).Error)
	require.Len(t, rows, 2)
	var pings []models.PingTask
	require.NoError(t, db.Order("id").Find(&pings).Error)
	require.Len(t, pings, 2)
	for i, ping := range pings {
		require.Equal(t, 180, ping.Interval)
		require.Equal(t, rows[i].Target, ping.Target)
		require.Equal(t, models.StringArray{"node-a"}, ping.Clients)
		require.Equal(t, rows[i].Id, *ping.ReturnRouteTaskID)
		require.Equal(t, ping.Id, *rows[i].MainlandReachabilityPingTaskID)
	}
	firstPingID := pings[0].Id
	p = serverParams(t, db, "node-a")
	p.PingInterval = 15
	p.Enabled = false
	require.NoError(t, saveReturnRouteServer(db, p))
	require.NoError(t, db.Order("id").Find(&pings).Error)
	for _, ping := range pings {
		require.Empty(t, ping.Clients)
		require.Equal(t, 15, ping.Interval)
	}
	p.Enabled = true
	p.PingInterval = 0
	p.Interval = 300
	require.NoError(t, saveReturnRouteServer(db, p))
	require.NoError(t, db.First(&pings[0], firstPingID).Error)
	require.Equal(t, 300, pings[0].Interval)
	require.Equal(t, models.StringArray{"node-a"}, pings[0].Clients)
	p = serverParams(t, db, "node-a")
	p.Targets = p.Targets[:1]
	require.NoError(t, saveReturnRouteServer(db, p))
	var count int64
	require.NoError(t, db.Model(&models.PingTask{}).Count(&count).Error)
	require.EqualValues(t, 1, count)
	require.NoError(t, db.Model(&models.MetricCleanupJob{}).Count(&count).Error)
	require.EqualValues(t, 1, count)
	require.Error(t, ensurePingTaskNotManaged(db, []uint{firstPingID}))
}

func TestServerTaskValidationIsAtomic(t *testing.T) {
	db := newReturnRouteServerTestDB(t)
	p := serverParams(t, db, "node-a")
	p.Targets = append(p.Targets, ReturnRouteServerTarget{Target: "bad", Carrier: "invalid", ExpectedLine: "CMIN2", IPVersion: 4})
	require.Error(t, saveReturnRouteServer(db, p))
	var count int64
	require.NoError(t, db.Model(&models.PingTask{}).Count(&count).Error)
	require.Zero(t, count)
	p = serverParams(t, db, "node-a")
	p.PingInterval = p.Interval + 1
	require.Error(t, saveReturnRouteServer(db, p))
	p.PingInterval = -1
	require.Error(t, saveReturnRouteServer(db, p))
	p.PingInterval = 1
	p.Targets = append(p.Targets, p.Targets[0])
	p.Targets[1].ID = 0
	require.Error(t, saveReturnRouteServer(db, p))
	p = serverParams(t, db, "node-a")
	p.Targets[0].ID = serverParams(t, db, "node-b").Targets[0].ID
	require.Error(t, saveReturnRouteServer(db, p))
	p = serverParams(t, db, "node-a")
	p.ExistingTargetIDs = nil
	require.Error(t, saveReturnRouteServer(db, p))
}

func TestServerQueryPaginationIncludesAllSiblingTargets(t *testing.T) {
	db := newReturnRouteServerTestDB(t)
	p := serverParams(t, db, "node-a")
	p.Targets = append(p.Targets, ReturnRouteServerTarget{Target: "mobile.example.com", Carrier: "mobile", ExpectedLine: "CMIN2", IPVersion: 6})
	require.NoError(t, saveReturnRouteServer(db, p))
	page, err := queryReturnRouteServers(db, ReturnRouteTaskQuery{Page: 1, PageSize: 1, Carrier: "telecom"})
	require.NoError(t, err)
	require.EqualValues(t, 1, page.Total)
	require.Len(t, page.Servers, 1)
	require.Len(t, page.Servers[0].Tasks, 2)
	page, err = queryReturnRouteServers(db, ReturnRouteTaskQuery{Page: 2, PageSize: 1})
	require.NoError(t, err)
	require.EqualValues(t, 3, page.Total)
	require.Len(t, page.Servers, 1)
	require.Equal(t, "node-b", page.Servers[0].Tasks[0].Client)
}

func TestServerTaskPreservesHistoryAndRetargetsPing(t *testing.T) {
	db := newReturnRouteServerTestDB(t)
	p := serverParams(t, db, "node-a")
	require.NoError(t, saveReturnRouteServer(db, p))
	id := p.Targets[0].ID
	var old models.ReturnRouteTask
	require.NoError(t, db.First(&old, id).Error)
	oldPingID := *old.MainlandReachabilityPingTaskID
	require.NoError(t, db.Create(&models.ReturnRouteEvent{TaskId: id, Client: "node-a", Kind: "switch", OccurredAt: time.Now()}).Error)
	p = serverParams(t, db, "node-a")
	p.Name = "renamed"
	require.NoError(t, saveReturnRouteServer(db, p))
	var status models.ReturnRouteStatus
	require.NoError(t, db.First(&status, "task_id = ?", id).Error)
	p.Targets[0].Target = "new.example.com"
	require.NoError(t, saveReturnRouteServer(db, p))
	var row models.ReturnRouteTask
	require.NoError(t, db.First(&row, id).Error)
	require.NotEqual(t, oldPingID, *row.MainlandReachabilityPingTaskID)
	require.ErrorIs(t, db.First(&status, "task_id = ?", id).Error, gorm.ErrRecordNotFound)
	var events int64
	require.NoError(t, db.Model(&models.ReturnRouteEvent{}).Where("task_id = ?", id).Count(&events).Error)
	require.EqualValues(t, 1, events)
}

func TestReturnRoutePingBackfillIsIdempotentAndLeavesManualTasks(t *testing.T) {
	db := newReturnRouteServerTestDB(t)
	manual := models.PingTask{Name: "manual", Clients: models.StringArray{"node-a"}, Type: "tcp", Target: "223.5.5.5:80", Interval: 5}
	require.NoError(t, db.Create(&manual).Error)
	require.NoError(t, reconcileReturnRoutePings(db))
	require.NoError(t, reconcileReturnRoutePings(db))
	var count int64
	require.NoError(t, db.Model(&models.PingTask{}).Count(&count).Error)
	require.EqualValues(t, 4, count)
	var got models.PingTask
	require.NoError(t, db.First(&got, manual.Id).Error)
	require.Equal(t, manual, got)
}

func TestServerSaveRollsBackAllTargetsIfPingCreationFails(t *testing.T) {
	db := newReturnRouteServerTestDB(t)
	p := serverParams(t, db, "node-a")
	p.Targets = append(p.Targets, ReturnRouteServerTarget{Target: "mobile.example.com", Carrier: "mobile", ExpectedLine: "CMIN2", IPVersion: 4})
	require.NoError(t, db.Exec(`CREATE TRIGGER fail_auto_ping BEFORE INSERT ON ping_tasks WHEN NEW.target = 'mobile.example.com' BEGIN SELECT RAISE(ABORT, 'injected ping creation failure'); END`).Error)
	require.ErrorContains(t, saveReturnRouteServer(db, p), "injected ping creation failure")
	var rows []models.ReturnRouteTask
	require.NoError(t, db.Where("client = ?", "node-a").Find(&rows).Error)
	require.Len(t, rows, 1)
	require.Equal(t, "Tokyo Telecom", rows[0].Name)
	require.Nil(t, rows[0].MainlandReachabilityPingTaskID)
	var count int64
	require.NoError(t, db.Model(&models.PingTask{}).Count(&count).Error)
	require.Zero(t, count)
}

func TestServerTargetValidatesCarrierLineAndAddressFamily(t *testing.T) {
	for _, task := range []models.ReturnRouteTask{
		{Target: "203.0.113.1", IPVersion: 6, Carrier: "mobile", ExpectedLine: "CMIN2"},
		{Target: "https://example.com/path", IPVersion: 4, Carrier: "mobile", ExpectedLine: "CMIN2"},
		{Target: "example.com:80", IPVersion: 4, Carrier: "mobile", ExpectedLine: "CMIN2"},
		{Target: "example.com", IPVersion: 4, Carrier: "telecom", ExpectedLine: "CMIN2"},
	} {
		require.Error(t, validateReturnRouteServerTarget(task))
	}
	require.NoError(t, validateReturnRouteServerTarget(models.ReturnRouteTask{Target: "example.com", IPVersion: 6, Carrier: "unicom", ExpectedLine: "CUG VIP"}))
}
