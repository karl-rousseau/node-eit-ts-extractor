/* jshint node:true, es5:true, bitwise:false, quotmark:single */
var fs = require('fs');
var Buffer = require('buffer').Buffer;

var _DEBUG_ = false, _WITH_LOGS_ = true;

var _MPEG_PACKET_SIZE_ = 188;
var _MPEG_PACKET_SYNC_ = 0x47;
var _DVB_SDT_PID_ = 0x11;
var _DVB_EIT_PID_ = 0x12;

var ts_data = {
    'channels': [], // array of DVB channel triplet (to compare with the SDT table)
    'eit': {} // list of EIT by eventId
};

var Reset='\x1b[0m',Bright='\x1b[1m',Dim='\x1b[2m',Underscore='\x1b[4m',Blink='\x1b[5m',Reverse='\x1b[7m',Hidden='\x1b[8m',
FgBlack='\x1b[30m',FgRed='\x1b[31m',FgGreen='\x1b[32m',FgYellow='\x1b[33m',FgBlue='\x1b[34m',FgMagenta='\x1b[35m',FgCyan='\x1b[36m',FgWhite='\x1b[37m',
BgBlack='\x1b[40m',BgRed='\x1b[41m',BgGreen='\x1b[42m',BgYellow='\x1b[43m',BgBlue='\x1b[44m',BgMagenta='\x1b[45m',BgCyan='\x1b[46m',BgWhite='\x1b[47m';

/** Polyfill to get the size of a list */
Object.prototype.size = function() {
    var s = 0, key;
    for (key in this) {
        if (this.hasOwnProperty(key))
            s++;
    }
    return s;
};

/** Utility object dealing with binary methods */
var bit = {
    encodeToHex: function(str) { // Decimal to Hex (without spacings)
        var r = '', e = str.length, c = 0, h;
        while (c < e) {
            h = str.charCodeAt(c++).toString(16);
            while (h.length < 2) h = '0' + h;
            r += h;
        }
        return r;
    },

    decodeFromHex: function(str) { // Hex to Decimal (without spacings)
        var r = '', e = str.length, s;
        while (e > 0) {
            s = e-2; r = String.fromCharCode('0x'+str.substring(s,e)) + r; e = s;
        }
        return r;
    },

    toBinary: function(decimal) { // BCD convertor
        if (typeof decimal != 'number')
            return ;
        var dec = decimal, i = dec, hit = '';
        while (i >= 1) {
            var m = (i * 10) / 4;
            while (m > 1) {
                m -= 5;
            }
            if (m < 0) {
                i = (i-1) / 2;
                hit += '1';
            } else {
                i = i / 2;
                hit += '0';
            }
        }
        var bin = '';
        for (var a = hit.length; a >= 0; a--)
            bin += hit.substring(a-1, a);
        return bin;
    },

    decimalTrunc: function(decimal) {
        return decimal - decimal % 1;
    }
};

/** Utility method to log a packet in an hexadecimal view */
function decodePacketToHexa(buf, pos) { // with separator by byte
    var r = '', e = buf.length, spos = 0, c = 0, h;

    while (c < e) {
        if (c % 8 == 0) // add one space separator
            r += ' ';
        if (c % 16 == 0) { // add current position at every start of new line ...
            spos = c; // saving starting position
            var t = (pos + c).toString(16);
            r += FgBlue + Array(8 - t.length).join('0') + t + ' ' + Reset;
        }

        h = (buf.readUInt8(c++)).toString(16);
        while (h.length < 2) h='0'+h;
        if (c==1 && h=='47') // 0x47 as MPEG header
            r += FgGreen + h + ' ';
        else if (c==2 || c==4) // part of MPEG header
            r += FgGreen + h + ' ';
        else if (c==3 && h=='12') // EIT pid = 0x12
            r += FgRed + h + ' ';
        else if (c==5 || c==6) // MPEG header tableId
            r += FgBlue + h + ' ';
        else if ((/*buf[3]=="12" &&*/ c==32) &&
                 (h=='4d' || h=='4e')) // EIT pid = 0x12 &&
                                       // descriptor tag value = 0x4d (short_event_descriptor)
                                       // descriptor tag value = 0x4e (extended_event_descriptor)
            r += FgMagenta + h + ' ';
        else if (buf[31]==0x4d && (c>=34 && c<=36)) // descriptor tag value = 0x4d +
            r += FgCyan + h + ' ';
        else
            r += h + ' ';
        if ((c % 16 == 0) || (c == e)) { // lines ending with ASCII readable char ...
            if (c == e)
                r += Array(1 + c % 16).join(' ');
            for (var i = spos; i < c; i++)
                r += (buf[i]>=32 && buf[i]<=126) ||
                     (buf[i]>=192 && buf[i]<=255) ? String.fromCharCode(buf[i]) : FgYellow + '.';
            r += '\n' + Reset;
        }
    }
    return r;
}

/** Utility method to extract a time */
function extractingDuration(duration) { // duration encoded in BCD notation (3 x 6 digits in 4-bit BCD)
    var durationToHex = bit.encodeToHex(duration);
    var hours = durationToHex.substr(0,2);
    var minutes = durationToHex.substr(2,2);
    var seconds = durationToHex.substr(4,2);
    return hours + ':' + minutes + ':' + seconds;
}

/** Utility method to extract a date */
function extractingDate(UTCdateArrayBuffer) {
    if (typeof Math.trunc == 'undefined')
        Math.trunc = function(n) { return n | 0; }; // warning: bitwise operator in 32-bit int max

    var UTCdateToHex = bit.encodeToHex(UTCdateArrayBuffer);

    var mjd = ((UTCdateArrayBuffer.charCodeAt(0) & 0xff) << 8) | (UTCdateArrayBuffer.charCodeAt(1) & 0xff);
    var hours =   UTCdateToHex.substr(4,2);
    var minutes = UTCdateToHex.substr(6,2);
    var seconds = UTCdateToHex.substr(8,2);

    if (_DEBUG_) console.log(Bright + FgMagenta + 'h:' + hours + ' m:' + minutes + ' s:' + seconds + ' mjd=' + mjd + Reset);

    // Decoding Algorithm: ETSI EN 300468 - ANNEX C

    var y = bit.decimalTrunc((mjd - 15078.2) / 365.25);
    var m = bit.decimalTrunc((mjd - 14956.1 - bit.decimalTrunc(y * 365.25) ) / 30.6001);
    var d = mjd - 14956 - bit.decimalTrunc(y * 365.25) - bit.decimalTrunc(m * 30.6001);
    var k = (m == 14) || (m == 15) ? 1 : 0;
    y = y + k + 1900;
    m = m - 1 - (k*12);

    if (_DEBUG_) console.log(Bright + FgMagenta + 'y:'+y+' m:'+m + Reset);
    return y + '-' + (m<=9?'0'+m:m) + '-' + (d<=9?'0'+d:d) + ' ' + hours + ':' + minutes + ':' + seconds;
}

/**
 * Method dealing with PSI tables and their descriptors ...
 */
function analyseServicesTable(buffer, pos) {
    var tableId = (buffer[5] & 0xff).toString(16);
    //console.log(BgBlue + 'mpeg packet #' + (pos/_MPEG_PACKET_SIZE_) + ' : tableId=0x' + tableId + Reset);
    if (tableId == '42' || // 0x42 -> Service Description Section - Actual transport stream
        tableId == '46' || // 0x46 -> Service Description Section - Other transport stream
        tableId == '4a') { // 0x4a -> Bouquet Association Section
        var sectionSyntaxIndicator = (buffer[6] & 0x80) >> 7;
        var sectionLength = ((buffer[6] & 0xf) << 8) | (buffer[7] & 0xff); // max = 1021 bytes (ending CRC included)
        var tsId = ((buffer[8] & 0xff) << 8) | (buffer[9] & 0xff);
        var versionNumber = (buffer[10] & 0x3e) >> 1;
        //var currentNextFlag = (buffer[10] & 0x1);
        var sectionNumber = (buffer[11] & 0xff);
        var lastSectionNumber = (buffer[12] & 0xff);
        var originalNetworkId = ((buffer[13] & 0xff) << 8) | (buffer[14] & 0xff);
        // skipping 8 bits reserved
        if (_WITH_LOGS_) console.log(BgBlue + 'mpeg packet #' + (pos/_MPEG_PACKET_SIZE_) + ' : SDT table / ' +
                    ' sectionSyntax=' + sectionSyntaxIndicator +
                    ' sectionLength=' + sectionLength +
                    ' versionNb=' + versionNumber +
                    ' sectionNb=' + sectionNumber +
                    ' lastSecNb=' + lastSectionNumber +
                    ' tsId=' + tsId + ' (0x'+buffer[8].toString(16)+' '+buffer[9].toString(16)+') ' +
                    ' originalNetworkId=' + originalNetworkId + ' (0x'+buffer[13].toString(16)+' '+buffer[14].toString(16)+')' + Reset);
        // N char ... (as a total of sectionLength)
        var i = 0, descriptorLength;
        do {
            var serviceId = ((buffer[16 + i] & 0xff) << 8) | (buffer[17 + i] & 0xff);
            var eitScheduleFlag = (buffer[18 + i] & 0x2) >> 1;
            var eitPresentFollowingFlag = (buffer[18 + i] & 0x1);
            var descriptorLoopLength = (buffer[19 + i] & 0xf) << 8 | (buffer[20 + i] & 0xff);
            if (_DEBUG_) console.log('serviceId:' + serviceId + ' eitSch:' + eitScheduleFlag + ' eitPF:' + eitPresentFollowingFlag + ' descLen:' + descriptorLoopLength);
            //console.log( buffer.slice(21 + i, 21 + i + descriptorLoopLength) );

            var descriptorTag = (buffer[21 + i] & 0xff);
            descriptorLength = (buffer[22 + i] & 0xff);
            if (descriptorTag.toString(16) == '48') { // tag 0x48 = Service Descriptor
                var serviceType = (buffer[23 + i] & 0xff);
                var serviceProviderLength = (buffer[24 + i] & 0xff);
                var serviceProvider = buffer.slice(25 + i, 25 + i + serviceProviderLength).toString('ascii');
                var serviceNameLength = (buffer[25 + i + serviceProviderLength] & 0xff);
                var serviceName = buffer.slice(26 + i + serviceProviderLength, 26 + i + serviceProviderLength + serviceNameLength).toString('ascii');
                if (_DEBUG_) console.log(FgMagenta + 'serviceType=' + serviceType + ' serviceProvider=' + serviceProvider + ' serviceName="' + serviceName + '"(' + serviceName.length + ')' + Reset);
                for (var l = 0, len = ts_data.channels.length; l < len; ++l) {
                    if (serviceId == ts_data.channels[l].sId &&
                        tsId == ts_data.channels[l].tsId &&
                        originalNetworkId == ts_data.channels[l].onId) {
                        ts_data.channels[l].name = serviceName;
                        l = ts_data.channels.length; // exit loop
                    }
                }
            }
            i += 1 + 4 + descriptorLoopLength;
            if (_DEBUG_) console.log('section ' + (16 + i) + ' / ' + (6 + sectionLength));

        } while (descriptorLength!=0 && (16 + i) < (6 + sectionLength - 16));

        if (_DEBUG_) console.log( decodePacketToHexa(buffer, pos) );
    }
}

function analyseEventProgramTable(buffer, pos, continuityCounter) {
    if (buffer[4] == 0) { // starting with 0 ? then its an EIT header with tableId, ...
        var tableId = (buffer[5] & 0xff).toString(16);
        if (tableId == '4d' ||
            tableId == '4e' || // EIT p/f actual
            tableId == '4f' || // EIT p/f other
            (tableId >= 80 && tableId <= 95) /*|| // EIT sch actual (0x50 -> 0x5f)
            (tableId >= 96 && tableId <= 111)*/) { // EIT sch other (0x60 -> 0x6f)
            var sectionSyntaxIndicator = (buffer[6] & 0x80) >> 7;
            var sectionLength = ((buffer[6] & 0xf) << 8) | (buffer[7] & 0xff); // max:4093 bytes (from next byte to the ending CRC included)
            var serviceId = ((buffer[8] & 0xff) << 8) | (buffer[9] & 0xff);
            var versionNumber = (buffer[10] & 0x3e) >> 1;
            var currentNextFlag = (buffer[10] & 0x1);
            var sectionNumber = (buffer[11] & 0xff);
            var lastSectionNumber = (buffer[12] & 0xff);
            var tsId = ((buffer[13] & 0xff) << 8) | (buffer[14] & 0xff);
            var originalNetworkId = ((buffer[15] & 0xff) << 8) | (buffer[16] & 0xff);
            var segmentLastSectionNumber = (buffer[17] & 0xff);
            var lastTableId = (buffer[18] & 0xff);
            // console.log('EIT: secSyntax=' + sectionSyntaxIndicator +
            //             ' sectionLen=' + sectionLength +
            //             ' (sId/tsId/onId)=' + serviceId + '/' + tsId + '/' + originalNetworkId +
            //             ' version=' + versionNumber +
            //             ' currentNextFlag=' + currentNextFlag +
            //             ' sectionNumber=' + sectionNumber +
            //             ' lastSectionNumber=' + lastSectionNumber +
            //             ' segmentLastSectionNumber=' + segmentLastSectionNumber +
            //             ' lastTableId=0x' + lastTableId.toString(16));
            var channelNotFound = true;
            for (var l = 0, len = ts_data.channels.length; l < len; ++l) {
                if (serviceId == ts_data.channels[l].sId &&
                    tsId == ts_data.channels[l].tsId &&
                    originalNetworkId == ts_data.channels[l].onId) {
                    channelNotFound = false;
                    l = ts_data.channels.length; // exit loop
                }
            }
            if (channelNotFound) {
                if (_DEBUG_) console.log('adding channel (' + serviceId + '/' + tsId + '/' + originalNetworkId + ')');
                ts_data.channels.push({ 'sId': serviceId, 'tsId': tsId, 'onId': originalNetworkId, 'name':'' }); // adding new channel
            }

            // loop ...
            for (var i = 0; i < 1; i++) {
                var eventId = (buffer[19 + i] & 0xff) | (buffer[20 + i] & 0xff);
                var startTime = String.fromCharCode(buffer[21 + i] & 0xff) +
                                String.fromCharCode(buffer[22 + i] & 0xff) +
                                String.fromCharCode(buffer[23 + i] & 0xff) +
                                String.fromCharCode(buffer[24 + i] & 0xff) +
                                String.fromCharCode(buffer[25 + i] & 0xff);
                //console.log( 'date:0x' + bit.encodeToHex(startTime) );
                startTime = extractingDate(startTime);

                var duration = String.fromCharCode(buffer[26 + i] & 0xff) +
                               String.fromCharCode(buffer[27 + i] & 0xff) +
                               String.fromCharCode(buffer[28 + i] & 0xff);
                duration = extractingDuration(duration);

                var runningStatus = (buffer[29 + i] & 0xe0) >> 5;
                var freeCAmode = (buffer[29 + i] & 0x10) >> 4;
                var descriptorLoopLength = (buffer[29 + i] & 0xf) << 8 | (buffer[30 + i] & 0xff);
                if (_WITH_LOGS_) console.log(FgCyan + 'EIT eventId=' + eventId +
                                            ' start=' + startTime +
                                            ' duration=' + duration +
                                            ' runningStatus=' + runningStatus +
                                            ' freeCA=' + freeCAmode +
                                            ' descLen=' + descriptorLoopLength + Reset);
                if (_DEBUG_) console.log( decodePacketToHexa(buffer, pos) );

                // TODO: merge all sections using cc field ...

                var gotEvent = false, p = i, /*old_p = p,*/ eitDescription = null, language = null, descriptorTag, descriptorLength;
                do {
                    descriptorTag = (buffer[31 + i + p] & 0xff); // 0x4d -> Short Event Descriptor / 0x4e -> Extented Event
                    descriptorLength = (buffer[32 + i + p] & 0xff);
                    var isoLanguageCode = String.fromCharCode(buffer[33 + i + p]) +
                                          String.fromCharCode(buffer[34 + i + p]) +
                                          String.fromCharCode(buffer[35 + i + p]);

                    var itemsLength = (buffer[36 + i + p] & 0xff);
                    var textLength = (buffer[37 + i + p] & 0xff);
                    // console.log((pos/_MPEG_PACKET_SIZE_) + ' descTag=0x' + descriptorTag.toString(16) +
                    //             ' descLen=' + descriptorLength +
                    //             ' isoLang=' + isoLanguageCode +
                    //             ' itemsLen=' + itemsLength +
                    //             ' textLen=' + textLength);
                    var txt = '';
                    for (var j = 0; j < /*descriptorLoopLength*/Math.min(_MPEG_PACKET_SIZE_ - 38 - p, descriptorLength - 5); j++) {
                        var c = buffer[38 + p + j];
                        txt += (c>=32 && c<=126) ||
                             (c>=192 && c<255) ? String.fromCharCode(c) : '.';
                    }
                    //console.log(txt);
                    //console.log(p + ' < ' + (38 + p + descriptorLength - 5));
                    if (eitDescription == null) // temporary saving (TO BE REMOVED)
                          eitDescription = txt;
                    if (language == null)
                          language = isoLanguageCode;

                    if ( (38 + p + descriptorLength - 5) < _MPEG_PACKET_SIZE_ /*&&
                         (p != old_p)*/ ) {
                        //old_p = p;
                        p += descriptorLength - 5;
                        gotEvent = true;
                    } else
                        gotEvent = false;

                    //console.log(p);
                } while (gotEvent);

                var EITid = eventId + '_' + serviceId + '_' + tsId + '_' + originalNetworkId;
                if ( !(EITid in ts_data.eit) ) {
                    if (descriptorTag.toString(16) != 'ff')
                        ts_data.eit[EITid] = {
                            '_packet': pos,
                            //'_payload': payloadUnitStartFlag,
                            '_cc': continuityCounter,
                            '_length': sectionLength,

                            'channel': { 'sId': serviceId, 'tsId': tsId, 'onId': originalNetworkId },
                            'start': startTime,
                            'duration': duration,
                            'runningStatus': runningStatus,
                            'language': language,
                            'description': eitDescription + ( eitDescription.length < sectionLength ? Array(1+sectionLength - eitDescription.length).join('.') : '')
                        };
                } else
                    if (_DEBUG_) console.error(BgRed + 'EIT already received !      #' + pos + ' EIT id=' + EITid + Reset);

                // TODO: check the ending CRC32 ...
            }
        }
    }
}

if (process.argv.length <= 2) {
    console.error('Usage: ' + __filename + ' xxxxxx.ts');
    console.error('       A Transport Stream input filename is needed as parameter!');
    process.exit(-1);
}
fs.open(process.argv[2], 'r', function(status, fd) { // reading external binary file ...
    if (status) { console.log(status.message); return; }
    fs.stat(process.argv[2], function(err, stats) { // retrieving its size ...
        var startingTime = new Date().getTime();
        var buffer = new Buffer(_MPEG_PACKET_SIZE_);

        for (var pos = 0; pos < stats.size; pos += _MPEG_PACKET_SIZE_) {
            fs.readSync(fd, buffer, 0, _MPEG_PACKET_SIZE_, pos); // SYNC -> TODO: async + split + Worker Threads

            var transportErrorFlag = (buffer[1] & 0x80) >> 7;
            var payloadUnitStartFlag = (buffer[1] & 0x40) >> 6;
            var transportPriorityFlag = (buffer[1] & 0x20) >> 5;
            var pid = (buffer[1] & 0x1f << 8) | (buffer[2] & 0xff); // 13 bit
            var scramblingControl = (buffer[3] & 0xc0) >> 6;
            var adaptationField = (buffer[3] & 0x20) >> 5;
            var containsPayload = (buffer[3] & 0x10) >> 4;
            var continuityCounter = (buffer[3] & 0xf);
            // TODO: payload to parse ...

            //console.log('TABLEID=0x'+(buffer[2] & 0xff).toString(16)+'  '+(buffer[1] & 0x1f).toString(16)+' '+(buffer[2] & 0xff).toString(16));
            if (buffer[0] == _MPEG_PACKET_SYNC_ &&
                transportErrorFlag == 0 &&
                scramblingControl == 0 &&
                (pid == _DVB_SDT_PID_ || pid == _DVB_EIT_PID_)) {
                // console.log( BgGreen + 'mpeg packet #' + (1 + pos/_MPEG_PACKET_SIZE_) + '/' + (stats.size / _MPEG_PACKET_SIZE_) +
                //                                   ' : tsErr=' + transportErrorFlag +
                //                                   ' payLoad=' + payloadUnitStartFlag +
                //                                   ' tsPrio=' + transportPriorityFlag +
                //                                   ' pid=0x' + pid.toString(16) +
                //                                   ' scramblingControl=' + scramblingControl +
                //                                   ' adaptationField=' + adaptationField +
                //                                   ' containsPayload=' + containsPayload +
                //                                   ' cc=' + continuityCounter + Reset);

                if (pid == _DVB_SDT_PID_) {
                    analyseServicesTable(buffer, pos);
                }

                else if (pid == _DVB_EIT_PID_) {
                    analyseEventProgramTable(buffer, pos, continuityCounter);
                }
            }
        }
        if (_DEBUG_) console.log(ts_data.channels);
        if (_DEBUG_) console.log(ts_data.eit);

        console.info( BgBlue + 'TOTAL number of services found: ' + ts_data.channels.length + Reset );
        console.info( BgBlue + 'TOTAL number of EIT found: ' + ts_data.eit.size() + Reset );
        console.info( BgBlue + 'TOTAL time spent: ' + Math.round((new Date().getTime() - startingTime)/1000) + 's' + Reset );
    });

});
