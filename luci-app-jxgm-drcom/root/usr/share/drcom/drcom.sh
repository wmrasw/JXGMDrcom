#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 wmrasw

#
# DrCOM web portal auto login - 江西工业贸易职业技术学院
#
# Contract used by LuCI and procd:
#   drcom.sh run     foreground loop: check connectivity, log in when offline
#   drcom.sh once    one check + login attempt (exit 0 on success)
#   drcom.sh check   exit 0 when the uplink already looks online
#
# Everything is configured through /etc/config/drcom (UCI); the school
# defaults below only apply when an option is missing.

. /lib/functions.sh

LOGFILE=/var/log/drcom.log
STATEFILE=/var/run/drcom.state
LOGFILE_MAX=262144

CFG_ENABLED=0
CFG_USERNAME=
CFG_PASSWORD=
CFG_OPERATOR=
CFG_IFACE=wan
CFG_PORTAL_URL='http://10.100.100.30:801/eportal/portal/login'
CFG_CHECK_URL='http://connect.rom.miui.com/generate_204'
CFG_INTERVAL=300
CFG_RETRY_INTERVAL=15
CFG_MAX_ATTEMPTS=3
CFG_COOLDOWN=300
CFG_CONNECT_TIMEOUT=5
CFG_USE_REAL_MAC=0
CFG_IGNORE_CONFIG_ERROR=0
CFG_LOG_LEVEL=info
CFG_DEVICE_TYPE=pc
CFG_V=7911
CFG_V_RANDOM=0
CFG_USER_AGENT=

LOG_LEVEL_NUM=2

usage() {
	echo "Usage: $0 {run|once|login|logout|check|probe <url>|discover|ip|mac|ua|set-mac <mac>}" >&2
	exit 1
}

level_num() {
	case "$1" in
		error) echo 0 ;;
		warn)  echo 1 ;;
		info)  echo 2 ;;
		debug) echo 3 ;;
		*)     echo 2 ;;
	esac
}

# Keep only digits and drop leading zeros, so a hand-edited UCI file cannot
# break $(( )) arithmetic (e.g. "08" is not a valid octal number).
numeric() {
	local v
	v=$(printf '%s' "$1" | tr -cd '0-9' | sed 's/^0*//')
	printf '%s' "${v:-0}"
}

# Portal messages that will not go away by retrying: a wrong password, an
# unknown account or a missing ISP suffix. Retrying those hammers the portal
# and can get the account locked, so back off hard instead.
is_fatal_login_error() {
	case "$1" in
		*密码错误*|*账号不存在*|*用户不存在*|*运营商出口*|*选择运营商*)
			return 0
			;;
	esac

	return 1
}

# procd always respawns the instance (respawn is not "on failure"), so exiting
# on a config error would just retry every five seconds. Park the loop instead
# and resume as soon as /etc/config/drcom changes; procd restarts the instance
# on that change too, whichever comes first.
config_mtime() {
	stat -c %Y /etc/config/drcom 2>/dev/null || echo 0
}

wait_config_change() {
	local before

	before=$(config_mtime)

	while :; do
		sleep 5

		if [ "$(config_mtime)" != "$before" ]; then
			log info "config changed, resuming"
			return 0
		fi
	done
}

login_error_hint() {
	case "$1" in
		*密码错误*)
			echo "check the password (基本 -> 密码)"
			;;
		*账号不存在*|*用户不存在*)
			echo "check the student ID (基本 -> 用户名)"
			;;
		*运营商出口*|*选择运营商*)
			echo "the ISP must not be empty (基本 -> 运营商)"
			;;
	esac
}

# Build the portal account string: ",<prefix>,<username>[@<operator>]".
account_string() {
	local prefix=0

	[ "$CFG_DEVICE_TYPE" = "mobile" ] && prefix=1

	printf ',%s,%s' "$prefix" "$CFG_USERNAME"

	[ -n "$CFG_OPERATOR" ] && printf '@%s' "$CFG_OPERATOR"

	return 0
}

# Portal unbind requests carry the IP as a decimal integer.
ip2long() {
	local IFS=.
	local a b c d

	set -- $1
	a=$1; b=$2; c=$3; d=$4

	case "${a}${b}${c}${d}" in
		''|*[!0-9]*) return 1 ;;
	esac

	[ -n "$d" ] || return 1

	echo $(( (a << 24) | (b << 16) | (c << 8) | d ))
}

# Derive the unbind endpoint from the configured login URL.
portal_unbind_url() {
	case "$CFG_PORTAL_URL" in
		*/portal/login)
			printf '%s/portal/mac/unbind' "${CFG_PORTAL_URL%/portal/login}"
			;;
		*)
			return 1
			;;
	esac
}

log() {
	local level="$1"
	shift

	[ "$(level_num "$level")" -le "$LOG_LEVEL_NUM" ] || return 0

	local line
	line="$(date '+%Y-%m-%d %H:%M:%S') [$level] $*"

	# stdout is forwarded to syslog by procd; the file is what LuCI reads.
	printf '%s\n' "$line"
	printf '%s\n' "$line" >> "$LOGFILE" 2>/dev/null
}

rotate_log() {
	[ -f "$LOGFILE" ] || return 0

	local size
	size=$(wc -c < "$LOGFILE" 2>/dev/null | tr -d ' ')
	[ -n "$size" ] || return 0
	[ "$size" -gt "$LOGFILE_MAX" ] || return 0

	tail -c $((LOGFILE_MAX / 2)) "$LOGFILE" > "$LOGFILE.tmp" 2>/dev/null &&
		mv "$LOGFILE.tmp" "$LOGFILE"
}

state_get() {
	[ -f "$STATEFILE" ] || return 0
	sed -n "s/^$1=//p" "$STATEFILE" | head -n 1
}

# Same as log() but keeps stdout clean for subcommands whose output is parsed
# by the LuCI view (discover).
logq() {
	log "$@" >/dev/null
}

state_set() {
	local status="$1"
	local message="$2"
	local last_login="${3:-$(state_get last_login)}"

	{
		printf 'status=%s\n' "$status"
		printf 'updated=%s\n' "$(date +%s)"
		printf 'last_login=%s\n' "$last_login"
		printf 'message=%s\n' "$message"
	} > "$STATEFILE.tmp" 2>/dev/null &&
		mv "$STATEFILE.tmp" "$STATEFILE"
}

load_config() {
	config_load drcom

	config_get_bool CFG_ENABLED main enabled 0
	config_get CFG_USERNAME main username
	config_get CFG_PASSWORD main password
	config_get CFG_OPERATOR main operator
	config_get CFG_IFACE main iface
	config_get CFG_PORTAL_URL main portal_url
	config_get CFG_CHECK_URL main check_url
	config_get CFG_INTERVAL main interval
	config_get CFG_RETRY_INTERVAL main retry_interval
	config_get CFG_MAX_ATTEMPTS main max_attempts
	config_get CFG_COOLDOWN main cooldown
	config_get CFG_CONNECT_TIMEOUT main connect_timeout
	config_get_bool CFG_USE_REAL_MAC main use_real_mac 0
	config_get_bool CFG_IGNORE_CONFIG_ERROR main ignore_config_error 0
	config_get CFG_LOG_LEVEL main log_level
	config_get CFG_DEVICE_TYPE main device_type
	config_get CFG_V main v
	config_get_bool CFG_V_RANDOM main v_random 0
	config_get CFG_USER_AGENT main user_agent

	CFG_IFACE=${CFG_IFACE:-wan}
	CFG_PORTAL_URL=${CFG_PORTAL_URL:-http://10.100.100.30:801/eportal/portal/login}
	CFG_CHECK_URL=${CFG_CHECK_URL:-http://connect.rom.miui.com/generate_204}
	CFG_LOG_LEVEL=${CFG_LOG_LEVEL:-info}
	CFG_DEVICE_TYPE=${CFG_DEVICE_TYPE:-pc}
	CFG_V=${CFG_V:-7911}

	CFG_INTERVAL=$(numeric "$CFG_INTERVAL")
	CFG_RETRY_INTERVAL=$(numeric "$CFG_RETRY_INTERVAL")
	CFG_MAX_ATTEMPTS=$(numeric "$CFG_MAX_ATTEMPTS")
	CFG_COOLDOWN=$(numeric "$CFG_COOLDOWN")
	CFG_CONNECT_TIMEOUT=$(numeric "$CFG_CONNECT_TIMEOUT")

	CFG_INTERVAL=${CFG_INTERVAL:-300}
	CFG_RETRY_INTERVAL=${CFG_RETRY_INTERVAL:-15}
	CFG_MAX_ATTEMPTS=${CFG_MAX_ATTEMPTS:-3}
	CFG_COOLDOWN=${CFG_COOLDOWN:-300}
	CFG_CONNECT_TIMEOUT=${CFG_CONNECT_TIMEOUT:-5}

	[ "$CFG_INTERVAL" -ge 5 ] || CFG_INTERVAL=300
	[ "$CFG_RETRY_INTERVAL" -ge 5 ] || CFG_RETRY_INTERVAL=15
	[ "$CFG_MAX_ATTEMPTS" -ge 1 ] || CFG_MAX_ATTEMPTS=3
	[ "$CFG_COOLDOWN" -ge 30 ] || CFG_COOLDOWN=300
	[ "$CFG_CONNECT_TIMEOUT" -ge 1 ] || CFG_CONNECT_TIMEOUT=5

	LOG_LEVEL_NUM=$(level_num "$CFG_LOG_LEVEL")
}

# Upstream (l3) device name for $CFG_IFACE; falls back to the interface name.
device_name() {
	local dev

	dev=$(ifstatus "$CFG_IFACE" 2>/dev/null |
		jsonfilter -e '@["l3_device"]' 2>/dev/null)
	[ -n "$dev" ] || dev="$CFG_IFACE"

	printf '%s' "$dev"
}

wan_ip() {
	local ip

	ip=$(ifstatus "$CFG_IFACE" 2>/dev/null |
		jsonfilter -e '@["ipv4-address"][0].address' 2>/dev/null)

	# $CFG_IFACE may be a device name (the UI selects devices), not a
	# logical interface; fall back to the kernel address table.
	[ -n "$ip" ] || ip=$(ip -4 addr show dev "$(device_name)" 2>/dev/null |
		sed -n 's/.*inet \([0-9.]*\).*/\1/p' | head -n 1)

	printf '%s' "$ip"
}

wan_mac() {
	local dev mac

	if [ "$CFG_USE_REAL_MAC" = "1" ]; then
		dev=$(device_name)
		mac=$(cat "/sys/class/net/${dev}/address" 2>/dev/null |
			tr -d ':' | tr 'a-f' 'A-F')

		[ -n "$mac" ] || mac=$(ip link show "$dev" 2>/dev/null |
			sed -n 's/.*link\/ether \([0-9a-fA-F:]*\).*/\1/p' |
			head -n 1 | tr -d ':' | tr 'a-f' 'A-F')

		printf '%s' "${mac:-000000000000}"
	else
		printf '000000000000'
	fi
}

is_online() {
	local code

	code=$(curl -s -o /dev/null -w '%{http_code}' \
		--connect-timeout "$CFG_CONNECT_TIMEOUT" \
		--max-time $((CFG_CONNECT_TIMEOUT * 2)) \
		"$CFG_CHECK_URL" 2>/dev/null)

	[ "$code" = "204" ]
}

# POST/GET to the eportal API.  Everything is percent-encoded by curl, so
# passwords containing &, +, = or non-ASCII characters work as expected.
portal_login() {
	local ip mac account prefix ttype v resp rc json result msg remain

	ip=$(wan_ip)
	if [ -z "$ip" ]; then
		log warn "no IPv4 address on $CFG_IFACE, skip login"
		state_set no-wan "WAN 未获取到 IPv4 地址"
		return 2
	fi

	mac=$(wan_mac)

	# The portal distinguishes PC from mobile by the account prefix and the
	# terminal_type parameter: ,0, + 1 = PC, ,1, + 2 = mobile.
	case "$CFG_DEVICE_TYPE" in
		mobile) ttype=2 ;;
		*)      ttype=1 ;;
	esac

	account=$(account_string)

	# The portal sends a random 4-digit v on every login; a fixed value works
	# too, so default to the configured one and randomize only on request.
	if [ "$CFG_V_RANDOM" = "1" ]; then
		v=$(( ($(date +%s) + $$) % 9000 + 1000 ))
	else
		v=$(numeric "$CFG_V")
		[ -n "$v" ] || v=7911
	fi

	log debug "login request: ip=$ip mac=$mac account=$CFG_USERNAME${CFG_OPERATOR:+@$CFG_OPERATOR} v=$v"

	set -- -s -G \
		--connect-timeout "$CFG_CONNECT_TIMEOUT" \
		--max-time $((CFG_CONNECT_TIMEOUT * 3))

	[ -n "$CFG_USER_AGENT" ] && set -- "$@" -A "$CFG_USER_AGENT"

	set -- "$@" \
		--data-urlencode "callback=dr1003" \
		--data-urlencode "login_method=1" \
		--data-urlencode "user_account=${account}" \
		--data-urlencode "user_password=${CFG_PASSWORD}" \
		--data-urlencode "wlan_user_ip=${ip}" \
		--data-urlencode "wlan_user_ipv6=" \
		--data-urlencode "wlan_user_mac=${mac}" \
		--data-urlencode "wlan_ac_ip=" \
		--data-urlencode "wlan_ac_name=" \
		--data-urlencode "jsVersion=4.2.1" \
		--data-urlencode "terminal_type=${ttype}" \
		--data-urlencode "lang=zh-cn" \
		--data-urlencode "v=${v}" \
		"$CFG_PORTAL_URL"
	resp=$(curl "$@" 2>/dev/null)
	rc=$?

	if [ "$rc" -ne 0 ]; then
		log error "login request failed (curl exit $rc)"
		state_set auth-failed "认证请求失败 (curl $rc)"
		return 1
	fi

	# dr1003({...});  ->  {...}
	json=$(printf '%s' "$resp" |
		sed -e 's/^[^(]*(//' -e 's/)[[:space:]]*;*[[:space:]]*$//')

	if command -v jsonfilter >/dev/null 2>&1; then
		result=$(printf '%s' "$json" | jsonfilter -e '@.result' 2>/dev/null)
		msg=$(printf '%s' "$json" | jsonfilter -e '@.msg' 2>/dev/null)
	else
		result=$(printf '%s' "$json" |
			sed -n 's/.*"result":[[:space:]]*\(-\{0,1\}[0-9][0-9]*\).*/\1/p')
		msg=$(printf '%s' "$json" |
			sed -n 's/.*"msg":[[:space:]]*"\([^"]*\)".*/\1/p')
	fi

	if [ -z "$result" ]; then
		log warn "unexpected portal response (wrong URL or HTTP error): $(printf '%s' "$json" | cut -c1-120)"
	fi

	[ -n "$msg" ] || msg="(no message)"

	if [ "$result" = "1" ]; then
		log info "login ok: $msg"
		state_set online "$msg" "$(date +%s)"
		return 0
	fi

	# "IP: x.x.x.x 已经在线！" comes back with result=0; the session is fine,
	# so treat it as success instead of logging a scary error.
	case "$msg" in
		*在线*)
			log info "already online: $msg"
			state_set online "$msg"
			return 0
			;;
	esac

	# Anti-sharing ban: the portal pauses the account and returns the remaining
	# seconds, e.g. "…账号将被停用一段时间 ... 161 s". Retrying during the pause
	# only returns the same message, so surface it as its own state.
	case "$msg" in
		*共享*|*路由器*)
			remain=$(printf '%s' "$msg" |
				sed -n 's/.*\.\.\.[[:space:]]*\([0-9][0-9]*\)[[:space:]]*s.*/\1/p')

			if [ -n "$remain" ]; then
				log warn "shared-network block: account paused, ${remain}s remaining"
				state_set auth-failed "被判定共享，${remain} 秒后可重试"
			else
				log warn "shared-network block: $msg"
				state_set auth-failed "$msg"
			fi

			return 1
			;;
	esac

	log error "login rejected: $msg (result=${result:-?})"
	[ -n "$json" ] && log debug "raw response: $(printf '%s' "$json" | cut -c1-200)"
	state_set auth-failed "$msg"
	return 1
}

do_logout() {
	local ip mac account url dec v resp rc json result msg

	load_config

	[ -n "$CFG_USERNAME" ] || {
		log error "username missing, nothing to log out"
		return 1
	}

	url=$(portal_unbind_url) || {
		log error "cannot derive unbind URL from '${CFG_PORTAL_URL}'"
		return 1
	}

	ip=$(wan_ip)
	if [ -z "$ip" ]; then
		log warn "no IPv4 address on $CFG_IFACE, skip logout"
		return 2
	fi

	mac=$(wan_mac)

	# The portal's own unbind request uses the bare account, without the
	# ",N," prefix that the login call carries.
	account=$CFG_USERNAME
	[ -n "$CFG_OPERATOR" ] && account="${account}@${CFG_OPERATOR}"

	dec=$(ip2long "$ip") || dec=$ip
	v=$(( ($(date +%s) + $$) % 9000 + 1000 ))

	log info "logout request: account=$CFG_USERNAME v=$v"

	resp=$(curl -s -G \
		--connect-timeout "$CFG_CONNECT_TIMEOUT" \
		--max-time $((CFG_CONNECT_TIMEOUT * 3)) \
		--data-urlencode "callback=dr1002" \
		--data-urlencode "user_account=${account}" \
		--data-urlencode "wlan_user_mac=${mac}" \
		--data-urlencode "wlan_user_ip=${dec}" \
		--data-urlencode "jsVersion=4.2.1" \
		--data-urlencode "v=${v}" \
		--data-urlencode "lang=zh" \
		"$url" 2>/dev/null)
	rc=$?

	if [ "$rc" -ne 0 ]; then
		log error "logout request failed (curl exit $rc)"
		return 1
	fi

	json=$(printf '%s' "$resp" |
		sed -e 's/^[^(]*(//' -e 's/)[[:space:]]*;*[[:space:]]*$//')

	if command -v jsonfilter >/dev/null 2>&1; then
		result=$(printf '%s' "$json" | jsonfilter -e '@.result' 2>/dev/null)
		msg=$(printf '%s' "$json" | jsonfilter -e '@.msg' 2>/dev/null)
	else
		result=$(printf '%s' "$json" |
			sed -n 's/.*"result"[[:space:]]*:[[:space:]]*\(-\{0,1\}[0-9][0-9]*\).*/\1/p')
		msg=$(printf '%s' "$json" |
			sed -n 's/.*"msg"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
	fi

	[ -n "$msg" ] || msg="(no message)"

	if [ "$result" = "1" ]; then
		log info "logout ok: $msg"
		state_set offline "已退出登录"
		return 0
	fi

	# Already offline: the portal has no session to unbind. Not an error.
	case "$msg" in
		*数据为空*|*不在线*|*未在线*)
			log info "already offline: $msg"
			state_set offline "已退出登录"
			return 0
			;;
	esac

	log warn "logout rejected: $msg"
	return 1
}

# Behind a captive portal every plain HTTP request is answered with a 302 to
# the portal login page, which reveals the portal host and port. If nothing
# redirects (already online) try once more following redirects and look for an
# ePortal URL in the body, which covers portals that redirect via JavaScript.
do_discover() {
	local url headers body loc host port result code

	load_config

	url=${CFG_CHECK_URL:-http://connect.rom.miui.com/generate_204}
	logq info "discover: probing $url"

	headers=$(curl -s -o /dev/null -D - \
		--connect-timeout "$CFG_CONNECT_TIMEOUT" \
		--max-time $((CFG_CONNECT_TIMEOUT * 2)) \
		--max-redirs 0 "$url" 2>/dev/null)

	loc=$(printf '%s' "$headers" | tr -d '\r' |
		sed -n 's/^[Ll]ocation:[[:space:]]*//p' | head -n 1)

	if [ -z "$loc" ]; then
		logq warn "discover: no redirect, probably already online"
		return 1
	fi

	logq info "discover: redirect -> $loc"

	case "$loc" in
		http://*|https://*) ;;
		*) loc="http://$loc" ;;
	esac

	# Most campuses redirect to a landing page that carries the portal address
	# in JS variables (v4serip / ss6) rather than a ready-made ePortal URL.
	body=$(curl -s -L \
		--connect-timeout "$CFG_CONNECT_TIMEOUT" \
		--max-time $((CFG_CONNECT_TIMEOUT * 3)) "$loc" 2>/dev/null)

	body=$(printf '%s' "$body" | tr -d '\r' | sed 's#\\/#/#g')
	logq debug "discover: landing page: $(printf '%s' "$body" | head -c 300)"

	host=$(printf '%s' "$body" |
		sed -n "s/.*v4serip=['\"]\([0-9.]\{7,\}\)['\"].*/\1/p" | head -n 1)

	[ -n "$host" ] || host=$(printf '%s' "$body" |
		sed -n 's/.*ss6="\([0-9.]\{7,\}\)".*/\1/p' | head -n 1)

	[ -n "$host" ] || host=$(printf '%s' "$loc" |
		sed -n 's#^https\?://\([^/:]*\).*#\1#p')

	[ -n "$host" ] || {
		logq warn "discover: cannot find the portal host on $loc"
		return 1
	}

	logq info "discover: portal host $host, probing ports"

	for port in 801 80 8080 8081 8000 8090; do
		code=$(curl -s -o /dev/null -w '%{http_code}' \
			--connect-timeout 2 --max-time 3 \
			"http://${host}:${port}/eportal/" 2>/dev/null)

		case "$code" in
			000|404) continue ;;
		esac

		logq info "discover: http://${host}:${port}/eportal/ -> HTTP $code"
		result="http://${host}:${port}/eportal/portal/login"
		break
	done

	[ -n "$result" ] || {
		logq warn "discover: host $host found, but no ePortal on ports 801/80/8080/8081/8000/8090"
		printf 'host=%s\n' "$host"
		return 2
	}

	printf '%s\n' "$result"
	logq info "discover: portal login at $result"
}
do_run() {
	load_config

	if [ -z "$CFG_USERNAME" ] || [ -z "$CFG_PASSWORD" ]; then
		log error "username or password missing in /etc/config/drcom"
		state_set auth-failed "未配置账号或密码"
		exit 1
	fi

	log info "service started (iface=$CFG_IFACE interval=${CFG_INTERVAL}s operator=${CFG_OPERATOR:-none})"

	fails=0

	while :; do
		rotate_log

		if [ -z "$(wan_ip)" ]; then
			log warn "$CFG_IFACE has no IPv4 address yet"
			state_set no-wan "等待 $CFG_IFACE 获取 IP"
			sleep "$CFG_RETRY_INTERVAL"
			continue
		fi

		if is_online; then
			fails=0
			msg=$(state_get message)

			# 例行检测不覆盖上一次的门户结果；状态变化时才写「已在线」。
			if [ "$(state_get status)" != "online" ] || [ -z "$msg" ]; then
				msg="已在线"
			fi

			state_set online "$msg"
			log debug "connectivity check ok"
			sleep "$CFG_INTERVAL"
			continue
		fi

		log warn "offline, trying to log in"
		state_set offline "检测到离线，正在登录"

		if portal_login; then
			fails=0
			sleep 2
			if is_online; then
				log info "online after login"
			else
				log warn "portal accepted the login but the uplink still looks offline"
			fi
			sleep "$CFG_INTERVAL"
		else
			fails=$((fails + 1))
			last=$(state_get message)

			if is_fatal_login_error "$last"; then
				hint=$(login_error_hint "$last")

				if [ "$CFG_IGNORE_CONFIG_ERROR" != "1" ]; then
					log error "login rejected by config: $last${hint:+ ($hint)}"
					log warn "paused; fix the config and save, or enable ignore_config_error"
					state_set config-error "$last"

					wait_config_change
					load_config
					fails=0
					continue
				fi

				log warn "login rejected by config: $last${hint:+ ($hint)} (ignore_config_error is on)"
			fi

			if [ "$fails" -ge "$CFG_MAX_ATTEMPTS" ]; then
				log warn "login failed $fails times, cooling down for ${CFG_COOLDOWN}s"
				state_set auth-failed "连续失败 ${fails} 次，冷静期 ${CFG_COOLDOWN} 秒后重试"
				sleep "$CFG_COOLDOWN"
				fails=0
			else
				sleep "$CFG_RETRY_INTERVAL"
			fi
		fi
	done
}

do_once() {
	load_config
	rotate_log

	if is_online; then
		log info "already online, nothing to do"
		state_set online "已在线"
		return 0
	fi

	portal_login
}

do_check() {
	load_config

	if is_online; then
		echo "online"
		return 0
	fi

	echo "offline"
	return 1
}

# Force one login attempt, skipping the 204 probe.  Used by the LuCI button
# so that a click really talks to the portal.
do_login() {
	load_config
	rotate_log
	log info "manual login requested"
	portal_login
}

# Probe an arbitrary URL and print its HTTP status code (000 when unreachable).
do_probe() {
	local url="$1" code

	load_config

	[ -n "$url" ] || { echo "000"; return 2; }

	code=$(curl -s -o /dev/null -w '%{http_code}' \
		--connect-timeout "$CFG_CONNECT_TIMEOUT" \
		--max-time $((CFG_CONNECT_TIMEOUT * 2)) \
		"$url" 2>/dev/null)

	[ -n "$code" ] || code=000

	echo "$code"
	[ "$code" = "204" ]
}

# Print the uplink IPv4 address.
do_ip() {
	load_config
	wan_ip
}

# Print the real MAC of the uplink device, colon separated.
do_mac() {
	local dev mac

	load_config

	dev=$(device_name)
	[ -n "$dev" ] || return 1

	mac=$(cat "/sys/class/net/${dev}/address" 2>/dev/null |
		tr 'a-f' 'A-F')

	[ -n "$mac" ] || mac=$(ip link show "$dev" 2>/dev/null |
		sed -n 's/.*link\/ether \([0-9a-fA-F:]*\).*/\1/p' |
		head -n 1 | tr 'a-f' 'A-F')

	echo "$mac"
	[ -n "$mac" ]
}

# Find the "config device" section belonging to a netdev.
find_device_section() {
	local dev="$1"

	uci show network 2>/dev/null |
		sed -n "s/^network\.\([^.]*\)\.name='\{0,1\}${dev}'\{0,1\}$/\1/p" |
		head -n 1
}

# Change the real MAC of the uplink device.  This writes /etc/config/network
# and reloads netifd, so the caller is expected to have warned the user.
do_set_mac() {
	local mac="$1" dev ref

	load_config

	printf '%s' "$mac" |
		grep -Eq '^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$' ||
		{ echo "invalid mac"; return 2; }

	dev=$(device_name)
	[ -n "$dev" ] || { echo "no device"; return 1; }

	ref=$(find_device_section "$dev")

	if [ -n "$ref" ]; then
		uci set "network.${ref}.macaddr=${mac}"
	else
		ref=$(uci add network device)
		uci set "network.${ref}.name=${dev}"
		uci set "network.${ref}.macaddr=${mac}"
	fi

	uci commit network || { echo "commit failed"; return 1; }

	ubus call network reload >/dev/null 2>&1

	echo "ok ${dev} ${mac}"
}

# Print curl's default User-Agent so the LuCI form can show it as placeholder.
do_ua() {
	local ver

	ver=$(curl --version 2>/dev/null | sed -n '1s/^curl \([0-9][0-9.]*\).*/\1/p')
	[ -n "$ver" ] || ver="8.x"

	printf 'curl/%s' "$ver"
}

case "$1" in
	run)   do_run ;;
	once)  do_once ;;
	login) do_login ;;
	logout) do_logout ;;
	check)  do_check ;;
	discover) do_discover ;;
	probe) do_probe "$2" ;;
	mac)   do_mac ;;
	ip)    do_ip ;;
	ua)    do_ua ;;
	set-mac) do_set_mac "$2" ;;
	*)     usage ;;
esac
