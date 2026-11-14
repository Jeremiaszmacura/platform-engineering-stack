package cluster

import (
	"context"
	"errors"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
	gatewayfake "sigs.k8s.io/gateway-api/pkg/client/clientset/versioned/fake"
)

func TestWatcherMapFromInformerCaches(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	client := fake.NewClientset(
		&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Namespace: "apps", Name: "api", Labels: map[string]string{"app": "api"}}},
		&corev1.ConfigMap{
			ObjectMeta: metav1.ObjectMeta{Namespace: "kube-system", Name: "kube-proxy"},
			Data:       map[string]string{"config.conf": "clusterCIDR: 10.244.0.0/16"},
		},
	)
	gateways := gatewayfake.NewClientset(
		&gatewayv1.HTTPRoute{ObjectMeta: metav1.ObjectMeta{Namespace: "apps", Name: "api-route"}},
	)
	w := NewWatcher(Clients{Core: client, Gateway: gateways}, Options{ClusterName: "test", Version: "v1.33.1"})

	if _, err := w.Map(ctx); !errors.Is(err, ErrNotSynced) {
		t.Fatalf("Map before Start: err = %v, want ErrNotSynced", err)
	}
	w.Start(ctx)
	waitSynced(t, w)

	m, err := w.Map(ctx)
	if err != nil {
		t.Fatalf("Map: %v", err)
	}
	if len(m.Pods) != 1 || m.Pods[0].ID != "apps/api" {
		t.Errorf("pods = %+v", m.Pods)
	}
	if len(m.Routes) != 1 || m.Routes[0].ID != "apps/api-route" {
		t.Errorf("routes = %+v", m.Routes)
	}
	if m.Ranges.Pods != "10.244.0.0/16" || m.Context != "test" {
		t.Errorf("ranges = %+v, context = %q", m.Ranges, m.Context)
	}
}

// waitSynced fails the test when the watcher's informers have not synced within 5 seconds.
func waitSynced(t *testing.T, w *Watcher) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !w.Ready() {
		if time.Now().After(deadline) {
			t.Fatal("informers did not sync")
		}
		time.Sleep(10 * time.Millisecond)
	}
}
