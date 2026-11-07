package cluster

import (
	"context"
	"errors"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
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
	w := NewWatcher(client, Options{ClusterName: "test", Version: "v1.33.1"})

	if _, err := w.Map(ctx); !errors.Is(err, ErrNotSynced) {
		t.Fatalf("Map before Start: err = %v, want ErrNotSynced", err)
	}
	w.Start(ctx)
	deadline := time.Now().Add(5 * time.Second)
	for !w.Ready() {
		if time.Now().After(deadline) {
			t.Fatal("informers did not sync")
		}
		time.Sleep(10 * time.Millisecond)
	}

	m, err := w.Map(ctx)
	if err != nil {
		t.Fatalf("Map: %v", err)
	}
	if len(m.Pods) != 1 || m.Pods[0].ID != "apps/api" {
		t.Errorf("pods = %+v", m.Pods)
	}
	if m.Ranges.Pods != "10.244.0.0/16" || m.Context != "test" {
		t.Errorf("ranges = %+v, context = %q", m.Ranges, m.Context)
	}
}
