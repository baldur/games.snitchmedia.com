ConnectFour = {};
ConnectFour.init = function() {
    var $container = $('<div>');
        $container.attr('id', 'container');
    var $ul = $('<ul>');
    var $li = $('<li>');

    $.each(new Array(5), function(k,v) {
        $ul.append($li.clone());
    });

    $.each(new Array(5), function(k,v) {
        $container.append($ul.clone());
    });

    $('body').prepend($container);

    return $container
};

$( function() {

    var $container = ConnectFour.init();

    var colors = ['yellow', 'red'];
    var turn = 0;

    var rememberedValue = function(current, remembered) {
        return current != "" && remembered === current;
    }

    $container.find('ul').click( function() {
        var color = colors[turn%2];
        var finder = 'li:not(.yellow):not(.red)';
        var circles = $(this).removeClass('in').find(finder);
        if(circles.length > 0){
            turn++;
            circles.last().addClass(color).trigger('check_win');
        }
    });

    $('body').bind('red_win', function(){
        $(this).addClass('red_win');
    });

    $('body').bind('yellow_win', function(){
        $(this).addClass('yellow_win');
    });

    $container.bind('check_win', function(){
        // no need to check till enough turns have passed
        if( turn < 7 ) { return false; }

        // check diagnol
        var indexes = [0,1,5];
        var range = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24];

        var forward = $('#container ul li');
        var backward = $($('#container ul').toArray().reverse()).find('li');
        var countConsecutive = function(remember, k, className) {
            if(rememberedValue(className, remember[k])) {
                count++;
                if(count > 2){
                    $container.trigger(className + "_win");
                    $container.find('ul').unbind('click');
                }
            } else {
                remember[k] = className;
                count = 0;
            }
        }

        var diagnal = function(index,collection,range){
            var startRow = new Array(index);
            $.each(startRow, function(k,v) {
                range.push(range.shift());
            });
            var row = [];
            $.each(range,function(k,v) {
                if(k%6 === index){
                    row.push(collection[k]) 
                }
                var remember = [];
                var count = 0;
                $.each(row, function(kk,vv) {
                    countConsecutive(remember, k, vv.className);
                });
            });
        };

        // check forward
        $.each(indexes, function(k,v){
            diagnal(v, forward, range);
        });

        // backward
        $.each(indexes, function(k,v){
            diagnal(v, backward, range);
        });

        // vertical check

        var checkWinVertical = function(k,v) {
            var remember = [];
            var count = 0;
            $(v).find('li').each(function(kk,vv){
                countConsecutive(remember, k, vv.className);
            });
        };

        $container.find('ul').each(checkWinVertical);

        // horizontal check
        $.each([1,2,3,4,5], function(k,v){
            var finder = 'ul li:nth-child('+v+')';
            var remember = [];
            var count = 0;
            $container.find(finder).each(function(kk,vv){
                countConsecutive(remember, k, vv.className);
            });
        });
    });

});
