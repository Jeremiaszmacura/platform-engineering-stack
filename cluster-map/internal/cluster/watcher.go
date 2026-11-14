// Package cluster keeps a watched, in-memory copy of the API objects the map needs.
package cluster

import (
	"context"
	"errors"
	"fmt"
	"time"

	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/cache"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
	gatewayclient "sigs.k8s.io/gateway-api/pkg/client/clientset/versioned"
	gatewayinformers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"

	"cluster-map/internal/topology"
)

// ErrNotSynced means the informers have not finished their first list yet.
var ErrNotSynced = errors.New("informer caches not synced yet")

// Options describe the cluster facts the API objects don't carry.
type Options struct {
	ClusterName string
	Version     string
	References  []topology.Reference
}

// Clients are the API clients the watcher reads from: core Kubernetes objects and Gateway API objects.
type Clients struct {
	Core    kubernetes.Interface
	Gateway gatewayclient.Interface
}

type lister[T any] interface {
	List(labels.Selector) ([]*T, error)
}

// Watcher lists and watches cluster objects through shared informers.
type Watcher struct {
	client         kubernetes.Interface
	factory        informers.SharedInformerFactory
	gatewayFactory gatewayinformers.SharedInformerFactory
	options        Options
	synced         []cache.InformerSynced

	nodes               lister[corev1.Node]
	pods                lister[corev1.Pod]
	services            lister[corev1.Service]
	serviceAccounts     lister[corev1.ServiceAccount]
	claims              lister[corev1.PersistentVolumeClaim]
	volumes             lister[corev1.PersistentVolume]
	gateways            lister[gatewayv1.Gateway]
	httpRoutes          lister[gatewayv1.HTTPRoute]
	networkPolicies     lister[networkingv1.NetworkPolicy]
	clusterRoles        lister[rbacv1.ClusterRole]
	roles               lister[rbacv1.Role]
	clusterRoleBindings lister[rbacv1.ClusterRoleBinding]
	roleBindings        lister[rbacv1.RoleBinding]
}

// NewWatcher registers one informer per object kind; call Start to begin watching.
func NewWatcher(clients Clients, options Options) *Watcher {
	f := informers.NewSharedInformerFactory(clients.Core, 0)
	gf := gatewayinformers.NewSharedInformerFactory(clients.Gateway, 0)
	core, networking, rbac, gateway := f.Core().V1(), f.Networking().V1(), f.Rbac().V1(), gf.Gateway().V1()
	w := &Watcher{
		client:              clients.Core,
		factory:             f,
		gatewayFactory:      gf,
		options:             options,
		nodes:               core.Nodes().Lister(),
		pods:                core.Pods().Lister(),
		services:            core.Services().Lister(),
		serviceAccounts:     core.ServiceAccounts().Lister(),
		claims:              core.PersistentVolumeClaims().Lister(),
		volumes:             core.PersistentVolumes().Lister(),
		networkPolicies:     networking.NetworkPolicies().Lister(),
		gateways:            gateway.Gateways().Lister(),
		httpRoutes:          gateway.HTTPRoutes().Lister(),
		clusterRoles:        rbac.ClusterRoles().Lister(),
		roles:               rbac.Roles().Lister(),
		clusterRoleBindings: rbac.ClusterRoleBindings().Lister(),
		roleBindings:        rbac.RoleBindings().Lister(),
	}
	for _, informer := range []cache.SharedIndexInformer{
		core.Nodes().Informer(), core.Pods().Informer(), core.Services().Informer(),
		core.ServiceAccounts().Informer(), core.PersistentVolumeClaims().Informer(), core.PersistentVolumes().Informer(),
		networking.NetworkPolicies().Informer(), gateway.Gateways().Informer(), gateway.HTTPRoutes().Informer(),
		rbac.ClusterRoles().Informer(), rbac.Roles().Informer(),
		rbac.ClusterRoleBindings().Informer(), rbac.RoleBindings().Informer(),
	} {
		w.synced = append(w.synced, informer.HasSynced)
	}
	return w
}

// Start begins listing and watching; informers stop when ctx is done.
func (w *Watcher) Start(ctx context.Context) {
	w.factory.Start(ctx.Done())
	w.gatewayFactory.Start(ctx.Done())
}

// Ready reports whether every informer has completed its first list.
func (w *Watcher) Ready() bool {
	for _, synced := range w.synced {
		if !synced() {
			return false
		}
	}
	return true
}

// Map builds the cluster map from the informer caches plus two ConfigMaps read on demand.
func (w *Watcher) Map(ctx context.Context) (topology.Map, error) {
	if !w.Ready() {
		return topology.Map{}, ErrNotSynced
	}
	proxyConfig, err := w.configValue(ctx, "kube-system", "kube-proxy", "config.conf")
	if err != nil {
		return topology.Map{}, err
	}
	prometheusConfig, err := w.configValue(ctx, "monitoring", "prometheus-config", "prometheus.yml")
	if err != nil {
		return topology.Map{}, err
	}
	var errs []error
	snapshot := topology.Snapshot{
		ClusterName:         w.options.ClusterName,
		Version:             w.options.Version,
		TakenAt:             time.Now().UTC(),
		ProxyConfig:         proxyConfig,
		PrometheusConfig:    prometheusConfig,
		References:          w.options.References,
		Nodes:               list(w.nodes, &errs),
		Pods:                list(w.pods, &errs),
		Services:            list(w.services, &errs),
		ServiceAccounts:     list(w.serviceAccounts, &errs),
		Claims:              list(w.claims, &errs),
		Volumes:             list(w.volumes, &errs),
		Gateways:            list(w.gateways, &errs),
		HTTPRoutes:          list(w.httpRoutes, &errs),
		NetworkPolicies:     list(w.networkPolicies, &errs),
		ClusterRoles:        list(w.clusterRoles, &errs),
		Roles:               list(w.roles, &errs),
		ClusterRoleBindings: list(w.clusterRoleBindings, &errs),
		RoleBindings:        list(w.roleBindings, &errs),
	}
	if err := errors.Join(errs...); err != nil {
		return topology.Map{}, fmt.Errorf("list cached objects: %w", err)
	}
	return topology.Build(snapshot), nil
}

func list[T any](l lister[T], errs *[]error) []*T {
	items, err := l.List(labels.Everything())
	if err != nil {
		*errs = append(*errs, err)
	}
	return items
}

// configValue reads one key of a ConfigMap; a missing ConfigMap is not an error (e.g. no kube-proxy).
func (w *Watcher) configValue(ctx context.Context, namespace, name, key string) (string, error) {
	cm, err := w.client.CoreV1().ConfigMaps(namespace).Get(ctx, name, metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("get configmap %s/%s: %w", namespace, name, err)
	}
	return cm.Data[key], nil
}
