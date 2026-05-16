#######################################################################################################################
### DYE Web
### Local HTTP interface for browsing Decent shot history and editing DYE description metadata.
#######################################################################################################################

package require json
catch { package require json::write }

namespace eval ::plugins::DYE_Web {
	variable author "Gilad Gershtein"
	variable contact "genager@gmail.com"
	variable version 1.0
	variable github_repo ""
	variable name "DYE Web"
	variable description "Serves a modern mobile web interface for DYE/SDB shot history and description metadata."
	variable min_de1app_version {1.43.1}

	variable root_dir [file dirname [info script]]
	variable server {}
	variable clients
	array set clients {}
	variable settings
	if { ![array exists settings] } {
		array set settings {}
	}
	foreach {setting_name setting_default} [list \
		version $version \
		enabled 1 \
		bind_address "0.0.0.0" \
		port 8787 \
		require_token 0 \
		access_token "" \
		reference_shots "" \
	] {
		if { ![info exists settings($setting_name)] } {
			set settings($setting_name) $setting_default
		}
	}

	variable default_fields {
		bean_brand bean_type roast_date roast_level bean_notes
		grinder_model grinder_setting grinder_dose_weight
		drink_weight drink_tds drink_ey espresso_enjoyment espresso_notes
		my_name drinker_name
	}
	variable desired_shot_columns {
		clock filename rel_path file_modification_date archived removed shot_desc profile_title
		grinder_dose_weight drink_weight target_drink_weight extraction_time
		bean_brand bean_type bean_desc bean_notes roast_date roast_level
		grinder_model grinder_setting drink_tds drink_ey espresso_enjoyment espresso_notes
		my_name drinker_name beverage_type skin visualizer_link workflow
	}
	variable numeric_shot_columns {
		clock file_modification_date archived removed grinder_dose_weight drink_weight
		target_drink_weight extraction_time drink_tds drink_ey espresso_enjoyment
	}
}

proc ::plugins::DYE_Web::msg { args } {
	if { [llength $args] == 0 } return
	if { [string range [lindex $args 0] 0 0] eq "-" && [llength $args] > 1 } {
		catch { ::logging::default_logger [lindex $args 0] "::plugins::DYE_Web" {*}[lrange $args 1 end] }
	} else {
		catch { ::logging::default_logger "::plugins::DYE_Web" {*}$args }
	}
}

proc ::plugins::DYE_Web::preload {} {
	check_settings
	plugins save_settings DYE_Web
	return ""
}

proc ::plugins::DYE_Web::main {} {
	check_versions
	check_settings
	ensure_dependencies
	start_server
}

proc ::plugins::DYE_Web::check_versions {} {
	if { [catch {package version de1app} app_version] } return
	if { [package vcompare $app_version $::plugins::DYE_Web::min_de1app_version] < 0 } {
		error "DYE Web requires DE1app v$::plugins::DYE_Web::min_de1app_version or higher; current version is $app_version"
	}
}

proc ::plugins::DYE_Web::check_settings {} {
	variable settings
	variable version

	set_setting_default version $version
	set_setting_default enabled 1
	set_setting_default bind_address "0.0.0.0"
	set_setting_default port 8787
	set_setting_default require_token 0
	set_setting_default access_token ""
	set_setting_default reference_shots ""
	if { [string trim $settings(access_token)] eq "" } {
		set token [format "%x%x%x" [clock seconds] [pid] [expr {int(rand() * 2147483647)}]]
		set settings(access_token) [string range $token 0 15]
	}
	set settings(version) $version
}

proc ::plugins::DYE_Web::set_setting_default { name value } {
	variable settings

	if { ![info exists settings($name)] } {
		set settings($name) $value
	}
	return $settings($name)
}

proc ::plugins::DYE_Web::ensure_dependencies {} {
	set missing {}
	if { [plugins available SDB] } {
		plugins load SDB
	} else {
		lappend missing "SDB"
	}

	# DYE is optional for history browsing but required for Next Shot editing.
	if { [plugins available DYE] } {
		catch { plugins load DYE }
	}

	if { [llength $missing] > 0 } {
		error "Please enable/install the [join $missing {, }] plugin before enabling DYE Web"
	}
}

proc ::plugins::DYE_Web::start_server {} {
	variable settings
	variable server

	check_settings
	if { ![string is true $settings(enabled)] } {
		msg -INFO "DYE Web is disabled"
		return
	}

	if { $server ne "" } {
		catch { close $server }
		set server {}
	}

	set port [expr {int($settings(port))}]
	if { $port <= 0 || $port > 65535 } {
		set port 8787
		set settings(port) $port
	}

	set server [socket -server [namespace code accept] -myaddr $settings(bind_address) $port]
	msg -INFO "Listening on http://$settings(bind_address):$port/"
}

proc ::plugins::DYE_Web::stop_server {} {
	variable server
	variable clients

	if { $server ne "" } {
		catch { close $server }
		set server {}
	}
	foreach key [array names clients *,buffer] {
		set chan [lindex [split $key ,] 0]
		catch { close $chan }
	}
	array unset clients
}

proc ::plugins::DYE_Web::local_ip {} {
	variable settings

	set configured [string trim [value_or_default ::plugins::DYE_Web::settings(bind_address) "0.0.0.0"]]
	if { $configured ni {"" "0.0.0.0" "::"} && ![string match "127.*" $configured] } {
		return $configured
	}

	foreach cmd {{getprop dhcp.wlan0.ipaddress} {ip route get 1.1.1.1} {ifconfig wlan0}} {
		if { ![catch { exec {*}$cmd } ip] } {
			set ip [string trim $ip]
			if { [regexp {src ([0-9.]+)} $ip -> parsed] } {
				set ip $parsed
			} elseif { [regexp {inet (?:addr:)?([0-9.]+)} $ip -> parsed] } {
				set ip $parsed
			}
			if { [regexp {^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$} $ip] && ![string match "127.*" $ip] } {
				return $ip
			}
		}
	}

	foreach target {1.1.1.1 8.8.8.8 visualizer.coffee} {
		if { ![catch {
			set sock [socket $target 80]
			set ip [lindex [fconfigure $sock -sockname] 0]
			close $sock
			set ip
		} ip] && $ip ne "" && ![string match "127.*" $ip] } {
			return $ip
		}
	}

	return [info hostname]
}

proc ::plugins::DYE_Web::web_url {} {
	variable settings

	check_settings
	set url "http://[local_ip]:$settings(port)/"
	if { [string is true $settings(require_token)] } {
		append url "?token=$settings(access_token)"
	}
	return $url
}

proc ::plugins::DYE_Web::accept { chan addr port } {
	variable clients

	fconfigure $chan -blocking 0 -buffering none -translation binary -encoding binary
	set clients($chan,buffer) ""
	set clients($chan,addr) $addr
	fileevent $chan readable [namespace code [list read_request $chan]]
}

proc ::plugins::DYE_Web::read_request { chan } {
	variable clients

	if { [catch { read $chan } chunk] } {
		close_client $chan
		return
	}
	if { $chunk eq "" && [eof $chan] } {
		close_client $chan
		return
	}
	append clients($chan,buffer) $chunk
	set buffer $clients($chan,buffer)

	set header_end [string first "\r\n\r\n" $buffer]
	set sep_len 4
	if { $header_end < 0 } {
		set header_end [string first "\n\n" $buffer]
		set sep_len 2
	}
	if { $header_end < 0 } return

	set header_text [string range $buffer 0 [expr {$header_end-1}]]
	set body [string range $buffer [expr {$header_end+$sep_len}] end]
	set request [parse_headers $header_text]
	set content_length [dict get $request content_length]
	if { [string length $body] < $content_length } return

	fileevent $chan readable {}
	dict set request body [string range $body 0 [expr {$content_length-1}]]

	if { [catch { handle_request $chan $request } err opts] } {
		set error_info [dict get $opts -errorinfo]
		msg -ERROR "Request failed: $err\n$error_info"
		send_json $chan 500 [json_object [list ok [json_bool 0] error [json_string $err]]]
	}
	close_client $chan
}

proc ::plugins::DYE_Web::close_client { chan } {
	variable clients
	catch { close $chan }
	foreach key [array names clients $chan,*] {
		unset -nocomplain clients($key)
	}
}

proc ::plugins::DYE_Web::parse_headers { header_text } {
	set lines [split $header_text "\n"]
	set request_line [string trim [lindex $lines 0] "\r "]
	lassign [split $request_line " "] method target protocol
	set headers [dict create]
	set content_length 0

	foreach line [lrange $lines 1 end] {
		set line [string trim $line "\r "]
		if { [regexp {^([^:]+):[ \t]*(.*)$} $line -> key value] } {
			set key [string tolower $key]
			dict set headers $key $value
			if { $key eq "content-length" && [string is integer -strict $value] } {
				set content_length $value
			}
		}
	}

	set path $target
	set query ""
	set qmark [string first "?" $target]
	if { $qmark >= 0 } {
		set path [string range $target 0 [expr {$qmark-1}]]
		set query [string range $target [expr {$qmark+1}] end]
	}

	return [dict create \
		method [string toupper $method] \
		path [url_decode $path] \
		query [parse_query $query] \
		protocol $protocol \
		headers $headers \
		content_length $content_length \
		body ""]
}

proc ::plugins::DYE_Web::handle_request { chan request } {
	set method [dict get $request method]
	set path [dict get $request path]

	if { $method eq "OPTIONS" } {
		send_response $chan 204 "No Content" "text/plain" ""
		return
	}

	if { [string match "/api/*" $path] } {
		if { ![authorized $request] } {
			send_json $chan 401 [json_object [list ok [json_bool 0] error [json_string "Unauthorized"]]]
			return
		}
		handle_api $chan $request
		return
	}

	if { $method ni {GET HEAD} } {
		send_json $chan 405 [json_object [list ok [json_bool 0] error [json_string "Method not allowed"]]]
		return
	}
	serve_static $chan $path
}

proc ::plugins::DYE_Web::authorized { request } {
	variable settings

	check_settings
	if { ![string is true $settings(require_token)] } {
		return 1
	}

	set query [dict get $request query]
	set headers [dict get $request headers]
	set supplied ""
	if { [dict exists $query token] } {
		set supplied [dict get $query token]
	} elseif { [dict exists $headers x-dye-web-token] } {
		set supplied [dict get $headers x-dye-web-token]
	}
	return [expr {$supplied ne "" && $supplied eq $settings(access_token)}]
}

proc ::plugins::DYE_Web::handle_api { chan request } {
	set method [dict get $request method]
	set path [string trimright [dict get $request path] "/"]

	if { $path eq "/api/status" && $method eq "GET" } {
		send_json $chan 200 [api_status]
		return
	}
	if { $path eq "/api/schema" && $method eq "GET" } {
		send_json $chan 200 [api_schema]
		return
	}
	if { $path eq "/api/shots" && $method eq "GET" } {
		send_json $chan 200 [api_shots [dict get $request query]]
		return
	}
	if { [regexp {^/api/shots/([0-9]+)/visualizer$} $path -> clock] && $method in {POST PATCH} } {
		send_json $chan 200 [api_sync_visualizer_shot $clock [dict get $request body]]
		return
	}
	if { [regexp {^/api/shots/([0-9]+)/reference$} $path -> clock] && $method in {POST PATCH} } {
		send_json $chan 200 [api_reference_shot $clock [dict get $request body]]
		return
	}
	if { [regexp {^/api/shots/([0-9]+)/repeat$} $path -> clock] && $method eq "POST" } {
		send_json $chan 200 [api_repeat_shot $clock]
		return
	}
	if { [regexp {^/api/shots/([0-9]+)/profile$} $path -> clock] && $method eq "POST" } {
		send_json $chan 200 [api_load_shot_profile $clock]
		return
	}
	if { [regexp {^/api/shots/([0-9]+)$} $path -> clock] } {
		if { $method eq "GET" } {
			send_json $chan 200 [api_shot_detail $clock]
			return
		}
		if { $method in {PATCH POST} } {
			send_json $chan 200 [api_update_shot $clock [dict get $request body]]
			return
		}
	}
	if { $path eq "/api/next" } {
		if { $method eq "GET" } {
			send_json $chan 200 [api_next]
			return
		}
		if { $method in {PATCH POST} } {
			send_json $chan 200 [api_update_next [dict get $request body]]
			return
		}
	}
	if { [regexp {^/api/fields/([^/]+)/values$} $path -> field] && $method eq "GET" } {
		send_json $chan 200 [api_field_values [url_decode $field]]
		return
	}

	send_json $chan 404 [json_object [list ok [json_bool 0] error [json_string "API route not found"]]]
}

proc ::plugins::DYE_Web::serve_static { chan path } {
	variable root_dir

	if { $path eq "/" || $path eq "" } {
		set rel "index.html"
	} else {
		set rel [string trimleft $path "/"]
	}
	if { [string match "*..*" $rel] } {
		send_response $chan 403 "Forbidden" "text/plain" "Forbidden"
		return
	}

	set file_path [file normalize [file join $root_dir web $rel]]
	set web_root [file normalize [file join $root_dir web]]
	if { [string first $web_root $file_path] != 0 || ![file exists $file_path] || [file isdirectory $file_path] } {
		send_response $chan 404 "Not Found" "text/plain" "Not found"
		return
	}

	set fh [open $file_path rb]
	fconfigure $fh -translation binary
	set bytes [read $fh]
	close $fh
	send_response $chan 200 "OK" [mime_type $file_path] $bytes 1
}

proc ::plugins::DYE_Web::api_status {} {
	variable settings
	variable version

	check_settings
	set sdb_ok [expr {[namespace which -command ::plugins::SDB::get_db] ne ""}]
	set dye_ok [expr {[namespace exists ::plugins::DYE] && [namespace which -command ::plugins::DYE::shots::get_next] ne ""}]
	set count 0
	catch {
		set db [::plugins::SDB::get_db]
		set count [db eval {SELECT COUNT(clock) FROM V_shot WHERE removed=0}]
	}

	return [json_object [list \
		ok [json_bool 1] \
		name [json_string $::plugins::DYE_Web::name] \
		version [json_string $version] \
		sdb [json_bool $sdb_ok] \
		dye [json_bool $dye_ok] \
		shots [json_number $count] \
		port [json_number $settings(port)] \
		bind_address [json_string $settings(bind_address)] \
		require_token [json_bool $settings(require_token)] \
	]]
}

proc ::plugins::DYE_Web::api_schema {} {
	set fields_json {}
	foreach field [description_fields] {
		lappend fields_json [field_schema_json $field]
	}
	return [json_object [list ok [json_bool 1] fields [json_array_raw $fields_json]]]
}

proc ::plugins::DYE_Web::api_shots { query } {
	variable desired_shot_columns

	set db [::plugins::SDB::get_db]
	set available [db_columns V_shot]
	set columns {}
	foreach col $desired_shot_columns {
		if { $col in $available } {
			lappend columns $col
		}
	}
	if { [llength $columns] == 0 } {
		error "V_shot is missing expected columns"
	}

	set limit [query_int $query limit 300 1 2000]
	set where {removed=0}
	foreach {param column} {bean bean_desc profile profile_title grinder grinder_model} {
		if { [dict exists $query $param] && [string trim [dict get $query $param]] ne "" && $column in $available } {
			set value [dict get $query $param]
			lappend where "$column=[::plugins::SDB::string2sql $value]"
		}
	}
	if { [dict exists $query search] && [string trim [dict get $query search]] ne "" } {
		set pattern "%[string map {% \\% _ \\_} [dict get $query search]]%"
		set search_cols {}
		foreach col {shot_desc bean_brand bean_type profile_title grinder_model grinder_setting espresso_notes my_name drinker_name workflow} {
			if { $col in $available } {
				lappend search_cols "$col LIKE [::plugins::SDB::string2sql $pattern]"
			}
		}
		if { [llength $search_cols] > 0 } {
			lappend where "([join $search_cols { OR }])"
		}
	}
	if { [dict exists $query reference] && [string is true [dict get $query reference]] } {
		set clocks [reference_clocks]
		if { [llength $clocks] == 0 } {
			return [json_object [list ok [json_bool 1] shots [json_array_raw {}]]]
		}
		lappend where "clock IN ([join $clocks ,])"
	}

	set sql "SELECT [join $columns ,] FROM V_shot WHERE [join $where { AND }] ORDER BY clock DESC LIMIT $limit"
	set shots {}
	db eval $sql row {
		lappend shots [shot_row_json row $columns]
	}

	return [json_object [list ok [json_bool 1] shots [json_array_raw $shots]]]
}

proc ::plugins::DYE_Web::api_shot_detail { clock } {
	array set shot {}
	set loaded 0
	if { ![catch { ::plugins::SDB::load_shot $clock 1 1 1 1 } shot_list] && $shot_list ne "" } {
		array set shot $shot_list
		set loaded 1
	}
	if { !$loaded } {
		array set shot [shot_from_db $clock]
	}
	if { ![info exists shot(clock)] } {
		error "Shot $clock was not found"
	}

	set fields_json {}
	foreach field [description_fields] {
		set value ""
		if { [info exists shot($field)] } {
			set value $shot($field)
		}
		lappend fields_json [json_pair_object name $field value [field_value_json $field $value]]
	}

	set series [series_json_from_shot shot $clock]
	return [json_object [list \
		ok [json_bool 1] \
		shot [shot_detail_json shot] \
		fields [json_array_raw $fields_json] \
		series $series \
	]]
}

proc ::plugins::DYE_Web::api_update_shot { clock body } {
	set payload [parse_json_body $body]
	set updates [extract_field_updates $payload]
	if { [dict size $updates] == 0 } {
		error "No editable fields were supplied"
	}

	set path [::plugins::SDB::get_shot_file_path $clock]
	if { $path eq "" } {
		error "Shot file for $clock was not found"
	}

	array set changes {}
	dict for {field value} $updates {
		set changes($field) [normalize_field_value $field $value]
	}

	::plugins::SDB::modify_shot_file $path changes

	if { [value_or_default ::plugins::SDB::settings(db_persist_desc) 1] == 1 } {
		set changes(file_modification_date) [file mtime $path]
		::plugins::SDB::update_shot_description $clock changes
	}

	if { [info exists ::settings(espresso_clock)] && $clock == $::settings(espresso_clock) } {
		foreach field [array names changes] {
			if { [info exists ::settings($field)] } {
				set ::settings($field) $changes($field)
			}
		}
		catch { ::save_settings }
		catch { ::plugins::DYE::shots::define_last_desc }
	}

	return [api_shot_detail $clock]
}

proc ::plugins::DYE_Web::api_reference_shot { clock body } {
	set payload [parse_json_body $body]
	set current [reference_has_clock $clock]
	if { [dict exists $payload reference] } {
		set make_reference [string is true [dict get $payload reference]]
	} else {
		set make_reference [expr {!$current}]
	}
	set_reference_clock $clock $make_reference
	return [json_object [list \
		ok [json_bool 1] \
		clock [json_number $clock] \
		reference [json_bool $make_reference] \
	]]
}

proc ::plugins::DYE_Web::api_repeat_shot { clock } {
	if { [namespace which -command ::plugins::DYE::shots::source_next_from] eq "" } {
		error "DYE is not loaded; repeat is unavailable"
	}
	set what_to_copy {
		profile bean_brand bean_type roast_level roast_date bean_notes
		grinder_model grinder_setting grinder_dose_weight drink_weight my_name drinker_name
	}
	set ok [::plugins::DYE::shots::source_next_from $clock {} $what_to_copy]
	if { ![string is true $ok] } {
		error "Could not copy shot $clock to Next Shot"
	}
	foreach field {espresso_notes espresso_enjoyment drink_tds drink_ey} {
		if { [info exists ::plugins::DYE::settings(next_$field)] } {
			set ::plugins::DYE::settings(next_$field) ""
		}
	}
	set ::plugins::DYE::settings(next_modified) 1
	catch { ::plugins::DYE::shots::define_next_desc }
	catch { plugins save_settings DYE }
	catch { ::save_settings }
	return [json_object [list ok [json_bool 1] message [json_string "Shot copied to Next Shot"] next [api_next]]]
}

proc ::plugins::DYE_Web::api_load_shot_profile { clock } {
	array set shot {}
	if { ![catch { ::plugins::SDB::load_shot $clock 1 1 1 1 } shot_list] && $shot_list ne "" } {
		array set shot $shot_list
	}
	if { [array size shot] == 0 } {
		error "Shot $clock was not found"
	}
	if { [namespace which -command ::profile::import_legacy] eq "" } {
		error "Profile loading is unavailable in this DE1app build"
	}
	set imported [::profile::import_legacy [array get shot]]
	if { ![string is true $imported] } {
		if { [info exists shot(profile_filename)] && $shot(profile_filename) ne "" &&
				[namespace which -command ::select_profile] ne "" } {
			::select_profile $shot(profile_filename)
			set imported 1
		}
	}
	if { ![string is true $imported] } {
		error "Could not load the profile from shot $clock"
	}
	catch { ::save_settings }
	set title [expr {[info exists shot(profile_title)] ? $shot(profile_title) : ""}]
	set filename [expr {[info exists shot(profile_filename)] ? $shot(profile_filename) : ""}]
	return [json_object [list \
		ok [json_bool 1] \
		message [json_string "Profile loaded"] \
		profile_title [json_string $title] \
		profile_filename [json_string $filename] \
	]]
}

proc ::plugins::DYE_Web::api_sync_visualizer_shot { clock body } {
	set payload [parse_json_body $body]
	set requested [extract_field_updates $payload]

	array set shot {}
	if { ![catch { ::plugins::SDB::load_shot $clock 1 1 1 1 } shot_list] && $shot_list ne "" } {
		array set shot $shot_list
	} else {
		array set shot [shot_from_db $clock]
	}
	if { ![info exists shot(clock)] } {
		error "Shot $clock was not found"
	}

	set link [visualizer_url_from_shot shot]
	if { $link eq "" } {
		return [visualizer_sync_response 0 "" "" {} "This shot does not have a Visualizer link yet"]
	}
	set visualizer_id [visualizer_id_from_url $link]
	if { $visualizer_id eq "" } {
		return [visualizer_sync_response 0 "" $link {} "Could not read the Visualizer shot id from the link"]
	}

	set updates [visualizer_updates_from_fields $requested shot]
	if { [dict size $updates] == 0 } {
		return [visualizer_sync_response 0 $visualizer_id $link {} "No Visualizer-editable fields changed"]
	}

	if { ![plugins available visualizer_upload] } {
		return [visualizer_sync_response 0 $visualizer_id $link [dict keys $updates] "The Upload to Visualizer extension is not installed"]
	}
	if { ![plugins enabled visualizer_upload] } {
		return [visualizer_sync_response 0 $visualizer_id $link [dict keys $updates] "The Upload to Visualizer extension is disabled"]
	}
	catch { plugins load visualizer_upload }
	if { [namespace which -command ::plugins::visualizer_upload::has_credentials] eq "" ||
			![::plugins::visualizer_upload::has_credentials] } {
		return [visualizer_sync_response 0 $visualizer_id $link [dict keys $updates] "Visualizer username or password is not configured"]
	}

	return [visualizer_patch_shot $visualizer_id $link $updates]
}

proc ::plugins::DYE_Web::api_next {} {
	if { [namespace which -command ::plugins::DYE::shots::get_next] eq "" } {
		return [json_object [list ok [json_bool 0] error [json_string "DYE is not loaded; Next Shot editing is unavailable"]]]
	}

	array set shot [::plugins::DYE::shots::get_next]
	set fields_json {}
	foreach field [description_fields] {
		set value ""
		if { [info exists shot($field)] } {
			set value $shot($field)
		}
		lappend fields_json [json_pair_object name $field value [field_value_json $field $value]]
	}

	set shot(kind) next
	set shot(clock) 0
	set shot(filename) next
	set shot(shot_desc) [value_or_default ::plugins::DYE::settings(next_shot_desc) "Next shot"]

	return [json_object [list \
		ok [json_bool 1] \
		shot [shot_detail_json shot] \
		fields [json_array_raw $fields_json] \
		series [json_object [list]] \
	]]
}

proc ::plugins::DYE_Web::api_update_next { body } {
	if { [namespace exists ::plugins::DYE] == 0 } {
		error "DYE is not loaded; Next Shot editing is unavailable"
	}

	set payload [parse_json_body $body]
	set updates [extract_field_updates $payload]
	if { [dict size $updates] == 0 } {
		error "No editable fields were supplied"
	}

	dict for {field value} $updates {
		set value [normalize_field_value $field $value]
		set ::plugins::DYE::settings(next_$field) $value
		if { [info exists ::settings($field)] && $field ni {drink_tds drink_ey espresso_enjoyment espresso_notes} } {
			set ::settings($field) $value
		}
		if { $field eq "drink_weight" } {
			if { [info exists ::settings(settings_profile_type)] && $::settings(settings_profile_type) eq "settings_2c" } {
				set ::settings(final_desired_shot_weight_advanced) $value
			} else {
				set ::settings(final_desired_shot_weight) $value
			}
		}
	}
	set ::plugins::DYE::settings(next_modified) 1
	catch { plugins save_settings DYE }
	catch { ::save_settings }
	catch { ::plugins::DYE::shots::define_next_desc }

	return [api_next]
}

proc ::plugins::DYE_Web::api_field_values { field } {
	if { $field ni [description_fields] } {
		error "Unknown DYE description field '$field'"
	}
	set values {}
	catch { set values [::plugins::SDB::available_categories $field] }
	set json_values {}
	foreach value $values {
		if { [string trim $value] ne "" } {
			lappend json_values [json_string $value]
		}
	}
	return [json_object [list ok [json_bool 1] field [json_string $field] values [json_array_raw $json_values]]]
}

proc ::plugins::DYE_Web::description_fields {} {
	variable default_fields
	if { [namespace which -command metadata] ne "" || [namespace which -command ::metadata::fields] ne "" } {
		if { ![catch { metadata fields -domain shot -category description } fields] && [llength $fields] > 0 } {
			return $fields
		}
	}
	return $default_fields
}

proc ::plugins::DYE_Web::field_schema_json { field } {
	set props {
		name "" short_name "" name_plural "" short_name_plural ""
		data_type text section description subsection "" required 0
		propagate 0 min "" max "" default "" smallincrement ""
		bigincrement "" n_decimals "" measure_unit ""
	}
	array set meta $props
	foreach prop [array names meta] {
		catch { set meta($prop) [metadata get $field $prop] }
	}
	if { $meta(name) eq "" } { set meta(name) $field }
	if { $meta(short_name) eq "" } { set meta(short_name) $meta(name) }
	if { $meta(data_type) eq "" } { set meta(data_type) text }

	return [json_object [list \
		key [json_string $field] \
		name [json_string $meta(name)] \
		short_name [json_string $meta(short_name)] \
		section [json_string $meta(section)] \
		subsection [json_string $meta(subsection)] \
		data_type [json_string $meta(data_type)] \
		required [json_bool $meta(required)] \
		propagate [json_bool $meta(propagate)] \
		min [json_nullable_number $meta(min)] \
		max [json_nullable_number $meta(max)] \
		default [json_string $meta(default)] \
		smallincrement [json_nullable_number $meta(smallincrement)] \
		bigincrement [json_nullable_number $meta(bigincrement)] \
		n_decimals [json_nullable_number $meta(n_decimals)] \
		measure_unit [json_string $meta(measure_unit)] \
	]]
}

proc ::plugins::DYE_Web::field_data_type { field } {
	set data_type text
	catch { set data_type [metadata get $field data_type] }
	if { $data_type eq "" } { set data_type text }
	return $data_type
}

proc ::plugins::DYE_Web::field_value_json { field value } {
	set data_type [field_data_type $field]
	if { $data_type eq "number" } {
		return [json_nullable_number $value]
	}
	if { $data_type eq "boolean" } {
		if { $value eq "" } { return "null" }
		return [json_bool $value]
	}
	return [json_string $value]
}

proc ::plugins::DYE_Web::normalize_field_value { field value } {
	set data_type [field_data_type $field]
	if { $data_type eq "number" } {
		if { $value eq "" || $value eq "null" } { return "" }
		if { ![string is double -strict $value] } {
			error "$field must be numeric"
		}
		return $value
	}
	if { $data_type eq "boolean" } {
		return [expr {[string is true $value] ? 1 : 0}]
	}
	return [string trim $value]
}

proc ::plugins::DYE_Web::extract_field_updates { payload } {
	set allowed [description_fields]
	set updates [dict create]
	if { [dict exists $payload fields] } {
		set payload [dict get $payload fields]
	}
	dict for {field value} $payload {
		if { $field in $allowed } {
			dict set updates $field $value
		}
	}
	return $updates
}

proc ::plugins::DYE_Web::visualizer_updates_from_fields { requested shot_var } {
	upvar $shot_var shot

	set mapping {
		bean_brand bean_brand
		bean_type bean_type
		roast_level roast_level
		roast_date roast_date
		bean_notes bean_notes
		grinder_model grinder_model
		grinder_setting grinder_setting
		grinder_dose_weight bean_weight
		drink_weight drink_weight
		drink_tds drink_tds
		drink_ey drink_ey
		espresso_enjoyment espresso_enjoyment
		espresso_notes espresso_notes
		my_name barista
	}
	set updates [dict create]
	foreach {dye_field visualizer_field} $mapping {
		if { [dict size $requested] > 0 } {
			if { ![dict exists $requested $dye_field] } continue
			set value [dict get $requested $dye_field]
		} else {
			if { ![info exists shot($dye_field)] } continue
			set value $shot($dye_field)
		}
		dict set updates $visualizer_field [normalize_field_value $dye_field $value]
	}
	return $updates
}

proc ::plugins::DYE_Web::visualizer_url_from_shot { shot_var } {
	upvar $shot_var shot

	foreach field {repository_links visualizer_link visualizer_url} {
		if { [info exists shot($field)] } {
			set url [visualizer_url_from_value $shot($field)]
			if { $url ne "" } { return $url }
		}
	}
	return ""
}

proc ::plugins::DYE_Web::visualizer_url_from_value { value } {
	if { [regexp -nocase {(https?://visualizer\.coffee/shots/[^ \t\r\n\}\]]+)} $value -> url] } {
		return $url
	}
	if { [regexp -nocase {(https?://[^ \t\r\n\}\]]+/shots/[^ \t\r\n\}\]]+)} $value -> url] } {
		return $url
	}
	if { [regexp -nocase {(^|[^[:alnum:]])([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})([^[:alnum:]]|$)} $value -> _ id] } {
		return "https://visualizer.coffee/shots/$id"
	}
	return ""
}

proc ::plugins::DYE_Web::visualizer_id_from_url { url } {
	if { [regexp -nocase {/shots/([^/?# \t\r\n\}\]]+)} $url -> id] } {
		return $id
	}
	return ""
}

proc ::plugins::DYE_Web::visualizer_patch_shot { visualizer_id link updates } {
	if { [catch { package require http } err] } {
		return [visualizer_sync_response 0 $visualizer_id $link [dict keys $updates] "Tcl http package is not available: $err"]
	}
	if { [catch { package require tls } err] } {
		return [visualizer_sync_response 0 $visualizer_id $link [dict keys $updates] "Tcl tls package is not available: $err"]
	}

	variable ::plugins::visualizer_upload::settings
	set host [value_or_default ::plugins::visualizer_upload::settings(visualizer_url) "visualizer.coffee"]
	regsub -nocase {^https?://} $host "" host
	set host [string trimright $host "/"]
	set auth "Basic [binary encode base64 $settings(visualizer_username):$settings(visualizer_password)]"
	set url "https://$host/api/shots/$visualizer_id"
	set body [encoding convertto utf-8 [json_object [list shot [visualizer_shot_json $updates]]]]
	set headers [list Authorization $auth Accept "application/json"]
	set code 0
	set answer ""
	set full_code ""

	catch { ::http::register https 443 [list ::tls::socket -servername $host] }
	if { [catch {
		set token [::http::geturl $url \
			-headers $headers \
			-method PATCH \
			-type "application/json" \
			-query $body \
			-timeout 15000]
		set answer [::http::data $token]
		set code [::http::ncode $token]
		set full_code [::http::code $token]
		::http::cleanup $token
	} err] } {
		catch { ::http::cleanup $token }
		return [visualizer_sync_response 0 $visualizer_id $link [dict keys $updates] "Visualizer update failed: $err"]
	}

	if { $code < 200 || $code >= 300 } {
		set message "Visualizer update failed: $full_code"
		if { [string trim $answer] ne "" } {
			append message " - [visualizer_error_from_answer $answer]"
		}
		return [visualizer_sync_response 0 $visualizer_id $link [dict keys $updates] $message]
	}

	return [visualizer_sync_response 1 $visualizer_id $link [dict keys $updates] ""]
}

proc ::plugins::DYE_Web::visualizer_shot_json { updates } {
	set numeric_fields {bean_weight drink_weight drink_tds drink_ey espresso_enjoyment}
	set pairs {}
	dict for {field value} $updates {
		if { $field in $numeric_fields } {
			lappend pairs $field [json_nullable_number $value]
		} else {
			lappend pairs $field [json_string $value]
		}
	}
	return [json_object $pairs]
}

proc ::plugins::DYE_Web::visualizer_error_from_answer { answer } {
	set trimmed [string trim [encoding convertfrom utf-8 $answer]]
	if { [catch { ::json::json2dict $trimmed } parsed] == 0 && [dict exists $parsed error] } {
		return [dict get $parsed error]
	}
	if { [string length $trimmed] > 180 } {
		return "[string range $trimmed 0 176]..."
	}
	return $trimmed
}

proc ::plugins::DYE_Web::visualizer_sync_response { synced visualizer_id link fields error } {
	set field_json {}
	foreach field $fields {
		lappend field_json [json_string $field]
	}
	set pairs [list \
		synced [json_bool $synced] \
		id [json_string $visualizer_id] \
		url [json_string $link] \
		fields [json_array_raw $field_json] \
	]
	if { $error ne "" } {
		lappend pairs error [json_string $error]
	}
	return [json_object [list \
		ok [json_bool 1] \
		visualizer [json_object $pairs] \
	]]
}

proc ::plugins::DYE_Web::parse_json_body { body } {
	if { [string trim $body] eq "" } {
		return [dict create]
	}
	set body [encoding convertfrom utf-8 $body]
	if { [catch { ::json::json2dict $body } payload] } {
		error "Invalid JSON body"
	}
	return $payload
}

proc ::plugins::DYE_Web::reference_clocks {} {
	variable settings
	set clocks {}
	foreach clock $settings(reference_shots) {
		if { [string is integer -strict $clock] && $clock > 0 && $clock ni $clocks } {
			lappend clocks $clock
		}
	}
	return $clocks
}

proc ::plugins::DYE_Web::reference_has_clock { clock } {
	return [expr {$clock in [reference_clocks]}]
}

proc ::plugins::DYE_Web::set_reference_clock { clock make_reference } {
	variable settings
	set clocks [reference_clocks]
	if { [string is true $make_reference] } {
		if { $clock ni $clocks } {
			lappend clocks $clock
		}
	} else {
		set idx [lsearch -exact $clocks $clock]
		while { $idx >= 0 } {
			set clocks [lreplace $clocks $idx $idx]
			set idx [lsearch -exact $clocks $clock]
		}
	}
	set settings(reference_shots) $clocks
	plugins save_settings DYE_Web
	return $clocks
}

proc ::plugins::DYE_Web::shot_from_db { clock } {
	variable desired_shot_columns
	set db [::plugins::SDB::get_db]
	set available [db_columns V_shot]
	set columns {}
	foreach col $desired_shot_columns {
		if { $col in $available } { lappend columns $col }
	}
	array set shot {}
	set sql "SELECT [join $columns ,] FROM V_shot WHERE clock=$clock LIMIT 1"
	db eval $sql row {
		foreach col $columns {
			set shot($col) $row($col)
		}
	}
	return [array get shot]
}

proc ::plugins::DYE_Web::shot_row_json { row_var columns } {
	upvar $row_var row
	variable numeric_shot_columns
	set pairs {}
	foreach col $columns {
		if { $col in $numeric_shot_columns } {
			lappend pairs $col [json_nullable_number $row($col)]
		} else {
			lappend pairs $col [json_string $row($col)]
		}
	}
	set ratio ""
	if { [info exists row(grinder_dose_weight)] && [info exists row(drink_weight)] &&
			[string is double -strict $row(grinder_dose_weight)] && $row(grinder_dose_weight) > 0 &&
			[string is double -strict $row(drink_weight)] && $row(drink_weight) > 0 } {
		set ratio [format %.2f [expr {$row(drink_weight) / double($row(grinder_dose_weight))}]]
	}
	lappend pairs ratio [json_nullable_number $ratio]
	lappend pairs reference [json_bool [reference_has_clock $row(clock)]]
	lappend pairs iso_time [json_string [clock format $row(clock) -format {%Y-%m-%dT%H:%M:%S%z}]]
	return [json_object $pairs]
}

proc ::plugins::DYE_Web::shot_detail_json { shot_var } {
	upvar $shot_var shot
	set columns {
		kind clock filename path rel_path date_time local_time shot_desc profile_title
		profile_filename
		grinder_dose_weight drink_weight target_drink_weight extraction_time
		bean_brand bean_type bean_desc bean_notes roast_date roast_level
		grinder_model grinder_setting drink_tds drink_ey espresso_enjoyment espresso_notes
		my_name drinker_name beverage_type skin visualizer_link workflow
	}
	set pairs {}
	foreach col $columns {
		if { ![info exists shot($col)] } continue
		if { $col in {clock grinder_dose_weight drink_weight target_drink_weight extraction_time drink_tds drink_ey espresso_enjoyment} } {
			lappend pairs $col [json_nullable_number $shot($col)]
		} else {
			lappend pairs $col [json_string $shot($col)]
		}
	}
	if { [info exists shot(clock)] && [string is integer -strict $shot(clock)] && $shot(clock) > 0 } {
		lappend pairs iso_time [json_string [clock format $shot(clock) -format {%Y-%m-%dT%H:%M:%S%z}]]
		lappend pairs reference [json_bool [reference_has_clock $shot(clock)]]
	}
	return [json_object $pairs]
}

proc ::plugins::DYE_Web::series_json_from_shot { shot_var clock } {
	upvar $shot_var shot
	set series_map {
		elapsed graph_espresso_elapsed
		pressure graph_espresso_pressure
		weight graph_espresso_weight
		flow graph_espresso_flow
		flow_weight graph_espresso_flow_weight
		flow_weight_raw graph_espresso_flow_weight_raw
		temperature_basket graph_espresso_temperature_basket
		temperature_mix graph_espresso_temperature_mix
		water_dispensed graph_espresso_water_dispensed
		pressure_goal graph_espresso_pressure_goal
		flow_goal graph_espresso_flow_goal
		temperature_goal graph_espresso_temperature_goal
		state_change graph_espresso_state_change
		resistance graph_espresso_resistance
	}
	set pairs {}
	set have_series 0
	foreach {name key} $series_map {
		if { [info exists shot($key)] && [llength $shot($key)] > 0 } {
			lappend pairs $name [json_number_array $shot($key)]
			set have_series 1
		}
	}
	if { !$have_series } {
		return [series_json_from_db $clock]
	}
	return [json_object $pairs]
}

proc ::plugins::DYE_Web::series_json_from_db { clock } {
	set db [::plugins::SDB::get_db]
	set cols [db_columns shot_series]
	if { [llength $cols] == 0 } {
		return [json_object [list]]
	}
	array set values {}
	foreach col $cols {
		if { $col ne "shot_clock" } { set values($col) {} }
	}
	set sql "SELECT [join $cols ,] FROM shot_series WHERE shot_clock=$clock ORDER BY elapsed"
	db eval $sql row {
		foreach col $cols {
			if { $col ne "shot_clock" } {
				lappend values($col) $row($col)
			}
		}
	}
	set pairs {}
	foreach col [array names values] {
		lappend pairs $col [json_number_array $values($col)]
	}
	return [json_object $pairs]
}

proc ::plugins::DYE_Web::db_columns { table } {
	set db [::plugins::SDB::get_db]
	set columns {}
	db eval "PRAGMA table_info($table)" row {
		lappend columns $row(name)
	}
	return $columns
}

proc ::plugins::DYE_Web::parse_query { query } {
	set result [dict create]
	if { $query eq "" } { return $result }
	foreach pair [split $query &] {
		if { $pair eq "" } continue
		set eq [string first "=" $pair]
		if { $eq < 0 } {
			dict set result [url_decode $pair] ""
		} else {
			set key [url_decode [string range $pair 0 [expr {$eq-1}]]]
			set value [url_decode [string range $pair [expr {$eq+1}] end]]
			dict set result $key $value
		}
	}
	return $result
}

proc ::plugins::DYE_Web::query_int { query key default min max } {
	set value $default
	if { [dict exists $query $key] && [string is integer -strict [dict get $query $key]] } {
		set value [dict get $query $key]
	}
	if { $value < $min } { set value $min }
	if { $value > $max } { set value $max }
	return $value
}

proc ::plugins::DYE_Web::url_decode { value } {
	set value [string map {+ " "} $value]
	set out ""
	for { set i 0 } { $i < [string length $value] } { incr i } {
		set ch [string index $value $i]
		if { $ch eq "%" && $i+2 < [string length $value] } {
			set hex [string range $value [expr {$i+1}] [expr {$i+2}]]
			if { [scan $hex %x code] == 1 } {
				append out [format %c $code]
				incr i 2
				continue
			}
		}
		append out $ch
	}
	return $out
}

proc ::plugins::DYE_Web::mime_type { file_path } {
	switch -nocase -- [file extension $file_path] {
		.html { return "text/html; charset=utf-8" }
		.css { return "text/css; charset=utf-8" }
		.js { return "application/javascript; charset=utf-8" }
		.json { return "application/json; charset=utf-8" }
		.svg { return "image/svg+xml" }
		.png { return "image/png" }
		.jpg -
		.jpeg { return "image/jpeg" }
		default { return "application/octet-stream" }
	}
}

proc ::plugins::DYE_Web::send_json { chan status body } {
	set reason "OK"
	switch -- $status {
		200 { set reason "OK" }
		201 { set reason "Created" }
		204 { set reason "No Content" }
		400 { set reason "Bad Request" }
		401 { set reason "Unauthorized" }
		404 { set reason "Not Found" }
		405 { set reason "Method Not Allowed" }
		500 { set reason "Internal Server Error" }
	}
	send_response $chan $status $reason "application/json; charset=utf-8" $body
}

proc ::plugins::DYE_Web::send_response { chan status reason content_type body {already_bytes 0} } {
	if { $already_bytes } {
		set bytes $body
	} else {
		set bytes [encoding convertto utf-8 $body]
	}
	set headers "HTTP/1.1 $status $reason\r\n"
	append headers "Content-Type: $content_type\r\n"
	append headers "Content-Length: [string length $bytes]\r\n"
	append headers "Connection: close\r\n"
	append headers "Access-Control-Allow-Origin: *\r\n"
	append headers "Access-Control-Allow-Methods: GET, POST, PATCH, OPTIONS\r\n"
	append headers "Access-Control-Allow-Headers: Content-Type, X-DYE-Web-Token\r\n"
	append headers "\r\n"
	puts -nonewline $chan $headers
	puts -nonewline $chan $bytes
	flush $chan
}

proc ::plugins::DYE_Web::json_object { pairs } {
	if { [llength $pairs] == 0 } { return "{}" }
	set args {}
	foreach {key value} $pairs {
		lappend args $key $value
	}
	if { [llength [info commands ::json::write]] > 0 } {
		return [::json::write object {*}$args]
	}
	set encoded {}
	foreach {key value} $pairs {
		lappend encoded "[json_string $key]:$value"
	}
	return "{[join $encoded ,]}"
}

proc ::plugins::DYE_Web::json_pair_object { key1 value1 key2 value2_json } {
	return [json_object [list $key1 [json_string $value1] $key2 $value2_json]]
}

proc ::plugins::DYE_Web::json_array_raw { items } {
	return "\[[join $items ,]\]"
}

proc ::plugins::DYE_Web::json_number_array { items } {
	set encoded {}
	foreach item $items {
		lappend encoded [json_nullable_number $item]
	}
	return [json_array_raw $encoded]
}

proc ::plugins::DYE_Web::json_string { value } {
	if { [llength [info commands ::json::write]] > 0 } {
		return [::json::write string $value]
	}
	set value [string map [list "\\" "\\\\" "\"" "\\\"" "\n" "\\n" "\r" "\\r" "\t" "\\t"] $value]
	return "\"$value\""
}

proc ::plugins::DYE_Web::json_bool { value } {
	if { [string is true $value] } { return "true" }
	return "false"
}

proc ::plugins::DYE_Web::json_number { value } {
	if { [string is double -strict $value] || [string is integer -strict $value] } {
		return $value
	}
	return "0"
}

proc ::plugins::DYE_Web::json_nullable_number { value } {
	if { $value eq "" || $value eq "NULL" } {
		return "null"
	}
	if { [string is double -strict $value] || [string is integer -strict $value] } {
		return $value
	}
	return "null"
}
